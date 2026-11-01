import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRoomAdapter } from "./adapter.js";
import { createOfficeServer } from "../server/server.js";
import { approvedLocalPetFiles } from "../server/main.js";

const equal = (a: unknown, b: string) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req: IncomingMessage) {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 512_000) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export async function createSharedRoom({
  port = 4320,
  lan = false,
  token = randomBytes(24).toString("base64url"),
} = {}) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const room = createRoomAdapter();
  const bridge = await createOfficeServer({
    adapter: room.adapter,
    distDir: resolve(root, "dist"),
    petAssetFiles: await approvedLocalPetFiles(root),
  });
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a?.family === "IPv4" && !a.internal)
    .map((a) => a!.address);
  const allowed = new Set(["127.0.0.1", "localhost", ...(lan ? ips : [])]);
  const publishers = new Map<string, { secret: string; name: string }>();
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "";
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (!allowed.has(url.hostname))
        return json(res, 403, { error: "Unknown room host" });
      if (req.headers.origin && req.headers.origin !== `http://${host}`)
        return json(res, 403, { error: "Same-origin request required" });
      const bearer = req.headers.authorization?.replace(/^Bearer /, "");
      const cookie = req.headers.cookie
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("petstown_room="))
        ?.slice(14);
      const authorized = equal(bearer, token) || equal(cookie, token);
      if (url.pathname === "/api/room/session" && req.method === "POST") {
        if (!equal(bearer, token))
          return json(res, 401, { error: "Room invitation required" });
        res.setHeader(
          "Set-Cookie",
          `petstown_room=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`,
        );
        return json(res, 200, { connected: true });
      }
      if (url.pathname === "/api/room/enroll" && req.method === "POST") {
        if (!equal(bearer, token))
          return json(res, 401, { error: "Room invitation required" });
        if (publishers.size >= 12)
          return json(res, 409, { error: "Room participant limit reached" });
        const data = await body(req);
        if (
          typeof data.name !== "string" ||
          !data.name.trim() ||
          data.name.length > 40
        )
          return json(res, 400, {
            error: "A name of 1–40 characters is required",
          });
        const id = randomBytes(12).toString("hex"),
          secret = randomBytes(24).toString("base64url");
        publishers.set(id, { secret, name: data.name.trim() });
        return json(res, 200, { participantId: id, publisherToken: secret });
      }
      if (url.pathname === "/api/room/publish" && req.method === "POST") {
        const id = req.headers["x-participant-id"];
        const publisher = typeof id === "string" ? publishers.get(id) : null;
        if (!publisher || !equal(bearer, publisher.secret))
          return json(res, 401, { error: "Publisher credentials required" });
        const data = await body(req);
        room.upsert(id as string, publisher.name, data);
        return json(res, 200, { accepted: true });
      }
      if (url.pathname === "/api/room/info" && req.method === "GET") {
        if (!authorized)
          return json(res, 401, { error: "Room invitation required" });
        return json(res, 200, {
          inviteFragment: `room=${token}`,
          inviteBaseUrl:
            lan &&
            ips.length &&
            ["localhost", "127.0.0.1"].includes(url.hostname)
              ? `http://${ips[0]}:${req.socket.localPort}`
              : `http://${host}`,
          participants: publishers.size,
        });
      }
      if (url.pathname.startsWith("/api/room/"))
        return json(res, 404, { error: "Unknown room action" });
      if (
        (url.pathname.startsWith("/api/") ||
          url.pathname.startsWith("/pet-assets/")) &&
        !authorized
      )
        return json(res, 401, {
          error: "Open the room invitation link to join.",
        });
      // Only proxy the office API/static assets. The observer bridge itself stays loopback-only.
      const upstream = httpRequest(
        `${bridge.url}${url.pathname}${url.search}`,
        {
          method: req.method,
          headers: {
            host: `127.0.0.1:${bridge.port}`,
            ...(req.headers["x-office-token"]
              ? { "x-office-token": req.headers["x-office-token"] }
              : {}),
            ...(req.headers["last-event-id"]
              ? { "last-event-id": req.headers["last-event-id"] }
              : {}),
          },
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent)
          json(res, 502, { error: "Office bridge unavailable" });
        else res.destroy();
      });
      res.on("close", () => upstream.destroy());
      req.pipe(upstream);
    } catch {
      if (!res.headersSent) json(res, 400, { error: "Invalid room request" });
      else res.destroy();
    }
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(port, lan ? "0.0.0.0" : "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No room address");
  const interval = setInterval(() => room.expire(), 3000);
  interval.unref();
  return {
    url: `http://127.0.0.1:${address.port}`,
    lanUrls: ips.map((ip) => `http://${ip}:${address.port}`),
    token,
    async close() {
      clearInterval(interval);
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await bridge.close();
    },
  };
}
