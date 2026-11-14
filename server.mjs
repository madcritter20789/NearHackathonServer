import { createServer } from "node:http";
import { marketApi } from "./app.mjs";
import { nearMarket } from "./near-market.mjs";
import { createTinyTankHandler } from "./tiny-tank.mjs";

const port = Number(process.env.PORT ?? 18787);
const hosted = process.env.RENDER === "true";
const origin = new URL(process.env.ITCH_GAME_ORIGIN ?? `http://127.0.0.1:${port}`);
if (origin.protocol !== "https:" && (hosted || origin.origin !== `http://127.0.0.1:${port}`))
  throw new Error("Set ITCH_GAME_ORIGIN to the HTTPS origin of the game iframe.");

const codes = [process.env.BUYER_A_CODE, process.env.BUYER_B_CODE];
if (!codes.every(code => typeof code === "string" && /^[\w-]{32,128}$/.test(code)) || codes[0] === codes[1])
  throw new Error("Set two distinct buyer invite codes (32–128 URL-safe characters).");

const route = marketApi(nearMarket(process.env), origin.origin, new Map([
  [codes[0], process.env.BUYER_A_ACCOUNT], [codes[1], process.env.BUYER_B_ACCOUNT],
]));
const tinyTank = createTinyTankHandler(process.env);
createServer({ requestTimeout: 15000, headersTimeout: 10000 }, (request, response) => {
  const url = new URL("http://localhost" + (request.url.startsWith("/") ? request.url : "/"));
  const result = url.pathname.startsWith("/api/tiny-tank/")
    ? tinyTank(request, response, url)
    : route(request, response);
  result.catch(() => {
    if (response.headersSent) return response.destroy();
    response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ message: "The market is temporarily unavailable." }));
  });
}).listen(port, hosted ? "0.0.0.0" : "127.0.0.1", () => console.log(`Twisted Twenty-One API listening on ${port}`));
