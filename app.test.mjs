import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { marketApi } from "./app.mjs";

test("itch iframe can read and buy with a buyer code and no cookies", async t => {
  const origin = "https://html-classic.itch.zone";
  const code = "a".repeat(64);
  const account = "buyer.testnet";
  let buys = 0;
  const market = {
    view: async method => method === "get_offer"
      ? { charm_id: "velvet-rope", price: 10, stock: 2 - buys }
      : { credits: buys ? 0 : 10, receipt: buys ? {} : null },
    async buy(actor) {
      assert.equal(actor, account);
      buys++;
      return { status: "confirmed" };
    },
  };
  const server = createServer(marketApi(market, origin, new Map([[code, account]])));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/market`;
  const preflight = await fetch(base + "/buy", {
    method: "OPTIONS", headers: { origin, "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
  const offer = await fetch(base + "/offer", { headers: { origin } }).then(r => r.json());
  assert.equal(offer.stock, 2);
  assert.equal(offer.account, "");
  assert.equal((await fetch(base + "/offer", { headers: { origin: "https://other.example" } })).status, 403);
  assert.equal((await fetch(base + "/offer", { headers: { origin, authorization: "Bearer wrong" } })).status, 401);

  const purchase = (claimedAccount, withCode = true) => fetch(base + "/buy", {
    method: "POST", headers: { origin, "content-type": "application/json",
      ...(withCode ? { authorization: "Bearer " + code } : {}) },
    body: JSON.stringify({ account: claimedAccount, operation: "1".repeat(32), price: 10 }),
  });
  assert.equal((await purchase(account, false)).status, 403);
  assert.equal((await purchase("other.testnet")).status, 403);
  const receipt = await (await purchase(account)).json();
  assert.equal(receipt.status, "confirmed");
  assert.equal(receipt.stock, 1);
  assert.equal(receipt.credits, 0);
  assert.equal(buys, 1);
});
