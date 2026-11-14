import { timingSafeEqual } from "node:crypto";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";

const accountIdPattern = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/;
const sessionPattern = /^[a-f0-9]{64}$/;
const operationPattern = /^[a-f0-9]{32}$/;
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
export function createTinyTankHandler(env = process.env, rpc = provider) {
  const contractId = env.TINY_TANK_CONTRACT;
  const allowedOrigins = new Set((env.TINY_TANK_WEB_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean));
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))) {
      throw new Error("Configure exact HTTPS origins or 127.0.0.1 for Tiny Tank");
    }
  }
  const enabled = !!contractId;
  const sessions = enabled ? ["A", "B"].map(slot => {
    const accountId = env[`TINY_TANK_ACCOUNT_${slot}`];
    const token = env[`TINY_TANK_SESSION_${slot}`];
    const key = env[`TINY_TANK_KEY_${slot}`];
    if (!accountIdPattern.test(accountId) || !sessionPattern.test(token) || !key) {
      throw new Error(`Configure testnet session ${slot} in bridge/.env`);
    }
    return {
      accountId, token, busy: false, lastWrite: 0,
      account: new Account(accountId, rpc, KeyPairSigner.fromSecretKey(key)),
      transaction: null,
    };
  }) : [];
  if (enabled && (!accountIdPattern.test(contractId) || sessions[0].accountId === sessions[1].accountId ||
      sessions[0].token === sessions[1].token)) {
    throw new Error("Configure a testnet contract and two distinct accounts and session tokens");
  }

  function view(method, args = {}, blockQuery = { finality: "final" }) {
    return rpc.callFunction({ contractId, method, args, blockQuery });
  }

  async function status(session, operationId) {
    const account_id = session.accountId;
    const { header } = await rpc.viewBlock({ finality: "final" });
    const block = { blockId: header.hash };
    const [offer, player, receipt] = await Promise.all([
      view("get_offer", {}, block),
      view("get_player", { account_id }, block),
      operationId ? view("get_receipt", { account_id, operation_id: operationId }, block) : null,
    ]);
    if (!player || offer?.id !== "rotor") throw new Error("Unexpected contract state");
    return {
      network: "testnet", contract: contractId, account: account_id, offer, player, receipt,
      transaction: receipt && session.transaction?.operationId === operationId ? session.transaction.hash : null,
    };
  }

  const definitiveErrors = [
    "unauthorized_account", "invalid_operation_id", "operation_conflict", "offer_unavailable",
    "quote_changed", "already_owned", "sold_out", "insufficient_credits", "already_funded",
  ];
  return async (request, response, url) => {
    const send = (code, body) => {
      response.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    };
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return send(403, { error: "forbidden" });
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      if (!origin || !["/api/tiny-tank/state", "/api/tiny-tank/claim", "/api/tiny-tank/buy"].includes(url.pathname)) {
        return send(403, { error: "forbidden" });
      }
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Unity-Version",
      });
      return response.end();
    }
    if (!enabled) return send(503, { error: "service_unavailable" });
    const token = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const session = token && sessions.find(entry => timingSafeEqual(Buffer.from(token), Buffer.from(entry.token)));
    if (!session) return send(401, { error: "invalid_session" });

    const path = url.pathname.slice("/api/tiny-tank".length);
    const operationId = url.searchParams.get("operation_id");
    if (operationId !== null && !operationPattern.test(operationId)) return send(400, { error: "invalid_operation_id" });
    try {
      if (request.method === "GET" && path === "/state") return send(200, await status(session, operationId));
      if (request.method !== "POST" || !["/claim", "/buy"].includes(path)) return send(404, { error: "not_found" });
      if (!operationId || (request.headers["content-length"] ?? "0") !== "0" || request.headers["transfer-encoding"]) {
        return send(400, { error: "invalid_request" });
      }
      const buy = path === "/buy";
      const offer_id = url.searchParams.get("offer_id");
      const revision = url.searchParams.get("revision");
      if (buy && (offer_id !== "rotor" || !/^\d{1,9}$/.test(revision))) return send(400, { error: "invalid_request" });
      if (session.busy || Date.now() - session.lastWrite < 1500) return send(429, { error: "checking_status" });
      session.busy = true;
      session.lastWrite = Date.now();
      try {
        const args = { operation_id: operationId };
        if (buy) Object.assign(args, { offer_id, revision: Number(revision) });
        const methodName = buy ? "buy_rotor" : "claim_starter_credits";
        const outcome = await session.account.callFunctionRaw({
          contractId, methodName, args, waitUntil: "FINAL", gas: 30000000000000n,
        });
        session.transaction = { operationId, hash: outcome.transaction.hash };
        const state = await status(session, operationId);
        if (state.receipt) console.log(`${methodName} ${session.accountId}: ${session.transaction.hash}`);
        return state.receipt ? send(200, state) : send(503, { error: "checking_status" });
      } catch (error) {
        const failure = definitiveErrors.find(code => String(error).includes(code) || String(error.cause).includes(code));
        return send(failure ? 409 : 503, { error: failure ?? "checking_status" });
      } finally {
        session.busy = false;
      }
    } catch {
      return send(503, { error: "service_unavailable" });
    }
  };
}

