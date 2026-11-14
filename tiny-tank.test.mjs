import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createTinyTankHandler } from "./tiny-tank.mjs";

test("Tiny Tank allows its itch iframe preflight and reports missing deployment configuration", async () => {
  const path = "/api/tiny-tank/buy";
  const origin = "https://html-classic.itch.zone";
  const route = createTinyTankHandler({ TINY_TANK_WEB_ORIGINS: origin });
  const server = createServer((req, res) => route(req, res, new URL(req.url, "http://localhost")));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const preflight = await fetch(url + path, { method: "OPTIONS", headers: { Origin: origin } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization.*X-Unity-Version/);
    const rejected = await fetch(url + path, { method: "OPTIONS", headers: { Origin: "https://other.example" } });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
    const unconfigured = await fetch(url + "/api/tiny-tank/state");
    assert.equal(unconfigured.status, 503);
    assert.deepEqual(await unconfigured.json(), { error: "service_unavailable" });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
