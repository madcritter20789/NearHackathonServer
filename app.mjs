import { timingSafeEqual } from "node:crypto";

export function marketApi(market, gameOrigin, buyers) {
  const inFlight = new Set();
  const lastWrite = new Map();

  return async function route(request, response) {
    const origin = request.headers.origin;
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("Vary", "Origin");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const send = (code, data) => {
      response.writeHead(code, { "Content-Type": "application/json" });
      response.end(JSON.stringify(data));
    };
    if (path === "/healthz" && request.method === "GET") return send(200, { ok: true });
    if (origin && origin !== gameOrigin) return send(403, {});
    if (origin === gameOrigin) response.setHeader("Access-Control-Allow-Origin", gameOrigin);
    if (path !== "/api/market/offer" && path !== "/api/market/buy") return send(404, {});
    if (request.method === "OPTIONS") {
      if (origin !== gameOrigin) return send(403, {});
      response.writeHead(204, {
        "Access-Control-Allow-Methods": path.endsWith("/buy") ? "POST" : "GET",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Unity-Version",
        "Access-Control-Max-Age": "600",
      }).end();
      return;
    }

    const authorization = request.headers.authorization;
    const code = authorization?.match(/^Bearer ([\w-]{32,128})$/)?.[1];
    let account = "";
    if (code) {
      for (const [expected, buyer] of buyers)
        if (code.length === expected.length && timingSafeEqual(Buffer.from(code), Buffer.from(expected))) account = buyer;
    }
    if (authorization && !account) return send(401, { message: "Invalid buyer code." });
    const snapshot = async () => {
      const [offer, player] = await Promise.all([
        market.view("get_offer"), account ? market.view("get_player", { account }) : null,
      ]);
      return { charmId: offer.charm_id, stock: offer.stock, price: offer.price, account,
        credits: player?.credits ?? 0, ownsCharm: Boolean(player?.receipt) };
    };
    if (path === "/api/market/offer" && request.method === "GET") return send(200, await snapshot());
    if (path !== "/api/market/buy" || request.method !== "POST") return send(405, {});
    if (!account) return send(403, {});
    if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") return send(415, {});
    let input;
    try { input = JSON.parse(await smallBody(request)); }
    catch { return send(400, {}); }
    const { operation, price } = input ?? {};
    if (input?.account !== account) return send(403, {});
    if (typeof operation !== "string" || !/^[a-f0-9]{32}$/.test(operation) ||
        !Number.isSafeInteger(price) || price < 1 || price > 1000) return send(400, {});
    if (inFlight.has(account) || Date.now() - (lastWrite.get(account) ?? 0) < 2000) return send(429, {});
    inFlight.add(account);
    lastWrite.set(account, Date.now());
    try {
      const result = await market.buy(account, operation, price);
      send(200, { ...await snapshot(), ...result, operation });
    } finally {
      inFlight.delete(account);
    }
  };
}

async function smallBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 512) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
