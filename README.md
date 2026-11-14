# NEAR hackathon game APIs

One Render service serves Twisted Twenty-One at `/api/market/` and Tiny Tank at `/api/tiny-tank/`. Each game uses its own NEAR testnet contract, player accounts, scoped signing keys, and demo access codes. The Unity WebGL exports are hosted separately on itch.io. `/healthz` checks the shared process.

## Deploy on Render

1. Push this repo to a GitHub repository you own. Connect it in Render under **New → Web Service**. Use **Node**, **Free**, branch **main**, and leave **Root Directory** blank. Set **Build Command** to `npm ci`, **Start Command** to `npm start`, and **Health Check Path** to `/healthz`. Render supplies `PORT`, and the service selects the public bind address automatically.
2. Add the variables from `.env.example` in Render's **Environment** settings. The four blank `BUYER_*_KEY` and `BUYER_*_CODE` values come from the existing ignored `market-bridge/.env` in the Unity repo. Use the restricted testnet keys. Leave `PORT` unset and keep the keys and codes out of Git and the WebGL ZIP.
3. Set `ITCH_GAME_ORIGIN` to the origin of the embedded game, such as `https://html-classic.itch.zone`. It is the scheme and hostname of the iframe URL, with no path. If unsure, open the itch game, select its game frame in the browser DevTools console and evaluate `location.origin`. Set the exact result in Render and redeploy if it differs from the example.
4. Open `/healthz` and then `/api/market/offer` on your Render URL. The offer should show `velvet-rope` with price 10 and the current stock. The recording deployment starts at stock 2. A 404 at the root URL is expected.
5. Add the `TINY_TANK_*` variables from `.env.example`. Copy the private key and session values from the ignored `D:\unity\Let_Them_Swim\bridge\.env` into Render Environment. Set `TINY_TANK_WEB_ORIGINS` to the exact Tiny Tank iframe origin. Multiple exact origins can be comma-separated. Keep the two games' existing origin variables independent.

## Connect the itch.io build

1. In Unity, activate **Twisted Twenty-One WebGL** and export the game with the **TwistedTwentyOne** template.
2. In the exported `index.html`, replace `window.twistedMarketUrl = "";` with `window.twistedMarketUrl = "https://YOUR-SERVICE.onrender.com";`. ZIP the export with `index.html` at the archive root and upload it as an HTML game on itch.io. The Render URL is public. Only enter buyer codes in the game page's password field.
3. Open the itch page and try **Shared Charm Demo** as a spectator first. Then enter Buyer A's code, return to the game menu if needed, open **Shared Charm Demo**, and record the purchase and the **+22 Chips** result. Switch to Buyer B, return to the game menu, and reopen the demo to check stock. Buyer codes stay in the browser tab's session and the API works without a cross-site cookie.

Run `npm ci` then `npm test` to check the API locally. Render's free service may need time to wake on the first request. Warm it by opening the offer endpoint before recording.

## Connect the Tiny Tank itch.io build

1. Export Tiny Tank as WebGL from Unity. In the exported directory create `StreamingAssets/tiny-tank-market.json` with this content, replacing the URL with the shared Render origin.

   ```json
   {"origin":"https://YOUR-SERVICE.onrender.com"}
   ```

2. ZIP the export with `index.html` at the archive root and upload it to the separate Tiny Tank itch.io HTML game. The JSON contains only the public backend URL.
3. Open **Play → Supply Market** and enter the Tiny Tank demo access code privately. Use `TINY_TANK_SESSION_A` for the account that owns the rotor. Equip it and start the demo. Use `TINY_TANK_SESSION_B` in a separate browser session to see the shared stock with no rotor ownership.
4. For a fresh two-to-one purchase recording, provision a fresh Tiny Tank contract and update only the Tiny Tank environment variables. The current testnet contract has one unit remaining after the [verified purchase](https://explorer.testnet.near.org/transactions/FmXZJ3DFbPHFCLyuDwmzks6PdrYw92PAkHtyJMj3U1f8).
