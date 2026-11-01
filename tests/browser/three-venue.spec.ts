import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { officialPets } from '../../src/shared/pets';

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.openai.com/**', async route => {
    const pet = officialPets.find(asset => asset.imageUrl === route.request().url());
    if (!pet) return route.abort();
    await route.fulfill({ contentType: 'image/webp', headers: { 'Access-Control-Allow-Origin': '*' },
      body: await readFile(`.cache/pets/${pet.assetId}.webp`) });
  });
});
test("3D room uses native pets, existing inspection, camera controls and GLB export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByTestId("office-scene")).toHaveAttribute(
    "data-renderer",
    "three",
  );
  const pet = page.getByTestId("scene-agent-maple");
  await expect(pet).toHaveAttribute("data-pet-load", "loaded");
  // Reduced motion keeps the click target stable during deterministic checks.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await pet.click();
  await expect(page.getByTestId("selected-agent-name")).toHaveText("Maple");
  await expect(page.getByTestId("agent-task")).toContainText(
    "Inspect the current workspace",
  );
  await page.getByRole("button", { name: "Close pet details" }).click();
  await page.getByRole("button", { name: "Top view", exact: true }).click();
  await page.getByRole("button", { name: "Walls on", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Walls off", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export room", exact: true }).click();
  const result = await download;
  const bytes = await readFile((await result.path())!);
  expect(bytes.subarray(0, 4).toString()).toBe("glTF");
  const gltf = JSON.parse(
    bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
  );
  expect(gltf.nodes.length).toBeGreaterThan(100);
  expect(gltf.images ?? []).toHaveLength(0);
  expect(JSON.stringify(gltf)).not.toContain("Maple");
  await page.screenshot({ path: "/tmp/petstown-3d-venue.png" });
  await page.getByRole("button", { name: "2D view", exact: true }).click();
  await expect(page.getByTestId("office-map-surface")).toBeVisible();
  await page.getByRole("button", { name: "3D venue", exact: true }).click();
  await expect(page.getByTestId("office-scene")).toHaveAttribute(
    "data-renderer",
    "three",
  );
  expect(errors).toEqual([]);
});
test("3D room exposes pending attention and remains usable on a narrow screen", async ({
  page,
  request,
}) => {
  const waiting = await request.post("http://127.0.0.1:5418/events", {
    data: {
      type: "agent.state.changed",
      agentId: "willow",
      data: { runtimeState: "waiting-for-input" },
    },
  });
  expect(waiting.ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByTestId("scene-agent-willow").getByLabel("Unresolved request"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Home view", exact: true }),
  ).toBeInViewport();
  await page.getByTestId("scene-agent-willow").click();
  await expect(page.getByTestId("agent-inspector")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("3D pets complete an observed handoff and ignore its replay", async ({
  page,
  request,
}) => {
  const emit = async (type: string, agentId: string | null, data: unknown) => {
    const result = await request.post("http://127.0.0.1:5418/events", {
      data: { type, agentId, data },
    });
    expect(result.ok()).toBeTruthy();
  };
  const baseline = await (await request.get('/api/office')).json();
  for (const agent of baseline.agents) {
    if (!['maple', 'willow'].includes(agent.agentId)) continue;
    for (const requestId of agent.pendingRequestIds)
      await emit('request.resolved', agent.agentId, { requestId, reason: 'Synthetic handoff fixture setup' });
  }
  for (const id of ["maple", "willow"])
    await emit("agent.state.changed", id, { runtimeState: "working" });
  await emit("connection.changed", null, {
    connection: {
      status: "connected",
      lastObservedAt: new Date().toISOString(),
      message: "Explicit 3D handoff fixture",
    },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const maple = page.getByTestId("scene-agent-maple");
  await expect(maple).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/office")).json()).presentation.state,
    )
    .toBe("live");
  const id = randomUUID();
  const handoff = {
    handoffId: id,
    fromAgentId: "maple",
    toAgentId: "willow",
    summary: "3D fixture: share the venue notes",
    occurredAt: new Date().toISOString(),
    sourceItemId: id,
  };
  await emit("handoff.observed", "maple", { handoff });
  await expect(page.getByRole("status")).toContainText(handoff.summary);
  await expect(maple).toHaveAttribute("data-location", "water-cooler");
  await expect(page.getByTestId("scene-agent-willow")).toHaveAttribute(
    "data-location",
    "water-cooler",
  );
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(maple).toHaveAttribute("data-location", "floor");
  await emit("handoff.observed", "maple", { handoff });
  await emit("agent.state.changed", "maple", { runtimeState: "idle" });
  await expect(maple).toHaveAttribute("data-runtime-state", "idle");
  await expect(page.getByRole("status")).toHaveCount(0);
});

test('3D live idle and session-close observations show zz then play death once', async ({ page, request }) => {
  const emit = async (type: string, agentId: string | null, data: unknown) => {
    const response = await request.post('http://127.0.0.1:5418/events', { data: { type, agentId, data } });
    expect(response.ok()).toBeTruthy();
  };
  await emit('agent.state.changed', 'maple', { runtimeState: 'working' });
  await emit('connection.changed', null, { connection: { status: 'connected', lastObservedAt: new Date().toISOString(), message: 'Synthetic 3D lifecycle check' } });
  await page.goto('/');
  const pet = page.getByTestId('scene-agent-maple');
  await expect(pet).toBeVisible();
  await emit('agent.state.changed', 'maple', { runtimeState: 'idle' });
  await expect(pet).toHaveAttribute('data-idle-sleep', 'true');
  try {
    await emit('agent.closed', 'maple', { reason: 'Synthetic verified session end' });
    await expect(pet).toHaveAttribute('data-lifecycle-phase', 'dying');
    await expect(pet).toHaveAttribute('data-animation', 'failed');
    await expect(pet).toHaveCount(0);
    await page.reload();
    await expect(pet).toHaveCount(0);
  } finally {
    await emit('agent.state.changed', 'maple', { runtimeState: 'working' });
  }
});

test('default demo adds eight varied local pets without changing the observed office', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const observedBefore = await (await request.get('/api/office')).json();
  await page.goto('/');
  const demos = page.locator('.venue-pet-label[data-demo="true"]');
  await expect(page.getByTestId('demo-badge')).toHaveText('Demo · 8 simulated pets');
  await expect(page.locator('.venue-pet-label[data-demo="true"][data-pet-load="loaded"]')).toHaveCount(8);
  await page.getByTestId('scene-agent-petstown-demo:dewey').click();
  await expect(page.getByTestId('demo-details')).toContainText('no real work is running');
  await expect(page.getByTestId('agent-inspector')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/petstown-demo.png' });
  await page.getByRole('button', { name: 'Demo on', exact: true }).click();
  await expect(demos).toHaveCount(0);
  await expect(page.getByTestId('scene-agent-maple')).toBeVisible();
  const observedAfter = await (await request.get('/api/office')).json();
  expect(observedAfter.agents.map((agent: { agentId: string }) => agent.agentId))
    .toEqual(observedBefore.agents.map((agent: { agentId: string }) => agent.agentId));
  expect(JSON.stringify(observedAfter)).not.toContain('petstown-demo:');
});
