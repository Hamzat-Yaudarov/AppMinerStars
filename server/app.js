import express from "express";
import "./config/normalize.js"; // normalize env aliases early
import morgan from "morgan";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import { bot, webhookCallbackInstance, ensureWebhook } from "./telegram/bot.js";
import { initDb } from "./db/migrate.js";
import { requireEnv } from "./config/env.js";
import mineRouter from "./features/mine.js";
import profileRouter from "./features/profile.js";
import withdrawRouter from "./features/withdraw.js";
import shopRouter from "./features/shop.js";
import casesRouter from "./features/cases.js";
import gamesRouter from "./features/games.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");
app.use(morgan("dev"));
app.use(cors());
app.use(bodyParser.json());

// Health
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// Redirect root to miniapp
app.get("/", (_req, res) => res.redirect('/miniapp/'));

// Static MiniApp
app.use("/", express.static(path.join(__dirname, "../public")));

// Debug: webhook info (admin)
app.get('/api/bot/info', async (req, res) => {
  try {
    const info = await bot.api.getWebhookInfo();
    res.json({ ok: true, info });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// API routes (MiniApp)
app.use("/api/mine", mineRouter);
app.use("/api/profile", profileRouter);
app.use("/api/withdraw", withdrawRouter);
app.use("/api/shop", shopRouter);
app.use("/api/cases", casesRouter);
app.use("/api/games", gamesRouter);
import referralRouter from "./features/referral.js";
app.use("/api/referral", referralRouter);
app.use("/api/payments", (await import('./features/payments.js')).default);

// Telegram webhook
app.use("/api/bot", webhookCallbackInstance);

const PORT = process.env.PORT || 3000;

(async () => {
  await initDb();

  const server = app.listen(PORT, async () => {
    const baseUrl = process.env.BASE_URL?.replace(/\/$/, "") || "";
    const isProd = process.env.NODE_ENV === "production";
    console.log(`Server listening on :${PORT}`);
    if (isProd && baseUrl) {
      try {
        await ensureWebhook(`${baseUrl}/api/bot`);
        console.log("Webhook set to", `${baseUrl}/api/bot`);
      } catch (err) {
        console.error("Failed to set webhook:", err?.response?.data || err.message || err);
      }
    } else {
      console.log("Webhook not configured. Bot will not start long-polling automatically.");
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("Shutting down...");
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
})();
