import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./modules/auth/auth.routes.js";
import contestRoutes from "./modules/contest/contest.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import adminBootstrapRoutes from "./modules/admin/admin-bootstrap.routes.js";
import profileRoutes from "./modules/profile/profile.routes.js";
import walletRoutes from "./modules/wallet/wallet.routes.js";
import statsRoutes from "./modules/stats/stats.routes.js";

const app = express();

// Render places one trusted reverse proxy in front of the service.
// Trusting exactly one hop lets Express rate-limit by the client IP supplied
// through that proxy without trusting arbitrary X-Forwarded-For entries.
app.set("trust proxy", 1);

const corsOrigin = process.env.CORS_ORIGIN?.trim();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "style-src-attr": ["'unsafe-inline'"],
      },
    },
  }),
);
app.use(
  cors({
    origin: corsOrigin || true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "TOO_MANY_REQUESTS" },
});

const answerLimiter = rateLimit({
  // Legitimate users can submit twelve correct answers quickly, but should
  // not need dozens of requests in a minute. This is an IP-level outer guard;
  // the authoritative per-user game rules remain enforced in the service.
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "TOO_MANY_REQUESTS" },
});


const marketPriceIds = [
  "polygon-ecosystem-token", "tether", "usd-coin", "ethereum", "bitcoin",
  "solana", "binancecoin", "tron", "ripple", "dogecoin", "cardano",
  "avalanche-2", "chainlink", "dai", "litecoin", "polkadot", "stellar",
  "wrapped-bitcoin",
];
let cachedMarketPrices: Record<string, number> | null = null;
let marketPricesUpdatedAt: number | null = null;
let marketPricesCacheExpiresAt = 0;

const marketPriceLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "TOO_MANY_REQUESTS" },
});

app.get("/api/market/prices", marketPriceLimiter, async (_req, res) => {
  const now = Date.now();
  if (cachedMarketPrices && now < marketPricesCacheExpiresAt) {
    return res.json({ success: true, data: { prices: cachedMarketPrices, updatedAt: marketPricesUpdatedAt } });
  }

  try {
    const upstream = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=" +
        marketPriceIds.join(",") + "&vs_currencies=usd",
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
    );
    if (!upstream.ok) throw new Error("PRICE_PROVIDER_UNAVAILABLE");

    const payload: unknown = await upstream.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("INVALID_PRICE_PROVIDER_RESPONSE");
    }

    const prices: Record<string, number> = {};
    for (const id of marketPriceIds) {
      const quote = (payload as Record<string, unknown>)[id];
      if (quote && typeof quote === "object" && !Array.isArray(quote)) {
        const usd = (quote as Record<string, unknown>).usd;
        if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) prices[id] = usd;
      }
    }
    if (Object.keys(prices).length === 0) throw new Error("EMPTY_PRICE_PROVIDER_RESPONSE");

    cachedMarketPrices = prices;
    marketPricesUpdatedAt = Date.now();
    marketPricesCacheExpiresAt = marketPricesUpdatedAt + 60_000;
    return res.json({ success: true, data: { prices, updatedAt: marketPricesUpdatedAt } });
  } catch {
    if (cachedMarketPrices && marketPricesUpdatedAt !== null) {
      return res.json({ success: true, data: { prices: cachedMarketPrices, updatedAt: marketPricesUpdatedAt, stale: true } });
    }
    return res.status(503).json({ success: false, error: "PRICE_FEED_UNAVAILABLE" });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      project: "Wallet Hunt",
    },
  });
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/contests", (req, res, next) => {
  if (req.method === "POST" && req.path.endsWith("/submit")) {
    return answerLimiter(req, res, next);
  }
  return next();
});
app.use("/api/contests", contestRoutes);
app.use("/api/admin-bootstrap", authLimiter, adminBootstrapRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/stats", statsRoutes);

const frontendDist = path.resolve(process.cwd(), "../frontend/dist");
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return next();
    }

    return res.sendFile(path.join(frontendDist, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

export default app;
