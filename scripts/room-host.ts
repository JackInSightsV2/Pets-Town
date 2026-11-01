import { createSharedRoom } from "../src/room/host.js";
const args = process.argv.slice(2);
const index = args.indexOf("--port");
const port = Number(index >= 0 ? args[index + 1] : 4320);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid room port");
const room = await createSharedRoom({ port, lan: args.includes("--lan") });
console.log(
  `Shared pet room\n${[room.url, ...(args.includes("--lan") ? room.lanUrls : [])].map((url) => `${url}/#room=${room.token}`).join("\n")}\nPublisher token: ${room.token}\nOnly share this invitation with teammates. Keep this terminal open. Ctrl-C ends the room, not agent work.`,
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    if (!closing) {
      closing = true;
      void room.close();
    }
  });
