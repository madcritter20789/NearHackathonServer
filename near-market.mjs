import { Account, JsonRpcProvider } from "near-api-js";

export function nearMarket(env) {
  const { NEAR_CONTRACT_ID: contractId, NEAR_RPC_URL: nodeUrl } = env;
  const accountIds = [env.BUYER_A_ACCOUNT, env.BUYER_B_ACCOUNT];
  const validAccount = id => typeof id === "string" && /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.testnet$/.test(id);
  if (![contractId, ...accountIds].every(validAccount) || new Set(accountIds).size !== 2 ||
      new URL(nodeUrl).protocol !== "https:") throw new Error("Configure the testnet contract, RPC and two buyer accounts.");

  const keys = [env.BUYER_A_KEY, env.BUYER_B_KEY];
  if (!keys.every(key => typeof key === "string" && key.startsWith("ed25519:")))
    throw new Error("Configure two Ed25519 function-call keys.");
  const provider = new JsonRpcProvider({ url: nodeUrl });
  const buyers = new Map(accountIds.map((id, index) => [id, new Account(id, provider, keys[index])]));
  const view = (method, args = {}) => provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } });
  return {
    view,
    async buy(account, operation, price) {
      const args = { account, operation };
      const existing = await view("get_receipt", args);
      if (existing?.price === price) return { status: "confirmed", message: "Velvet Rope equipped." };
      const result = await buyers.get(account).callFunction({
        contractId, methodName: "buy_charm", args: { operation, expected_price: price },
        waitUntil: "FINAL",
      });
      if (!result) return { status: "pending", message: "Check the purchase again." };
      if (result.status !== "confirmed") return result;
      const receipt = await view("get_receipt", args);
      return receipt?.price === price
        ? result : { status: "pending", message: "Waiting for final confirmation." };
    },
  };
}
