import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { PostgresRateLimitStore } from "./config/postgres-rate-limit-store.js";

import authRoutes from "./modules/auth/auth.routes.js";
import contestRoutes from "./modules/contest/contest.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import adminBootstrapRoutes from "./modules/admin/admin-bootstrap.routes.js";
import profileRoutes from "./modules/profile/profile.routes.js";
import walletRoutes from "./modules/wallet/wallet.routes.js";
import { receiveTurnkeyWebhook } from "./modules/wallet/turnkey-webhook.service.js";
import statsRoutes from "./modules/stats/stats.routes.js";
import prisma from "./config/prisma.js";

const app = express();

// Render places one trusted reverse proxy in front of the service.
// Trusting exactly one hop lets Express rate-limit by the client IP supplied
// through that proxy without trusting arbitrary X-Forwarded-For entries.
app.set("trust proxy", 1);

// Never reflect arbitrary Origin values while credentials are enabled.
// The configured value accepts a comma-separated allowlist; known first-party
// production origins remain allowed even when the optional variable is absent.
const corsOrigins = new Set([
  "https://wallet-find.com",
  "https://www.wallet-find.com",
  "https://wallet-find.onrender.com",
  ...(process.env.CORS_ORIGIN ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
]);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": [
          ...(helmet.contentSecurityPolicy.getDefaultDirectives()["script-src"] ?? ["'self'"]),
          "https://challenges.cloudflare.com",
        ],
        "frame-src": ["https://challenges.cloudflare.com"],
        "connect-src": [
          ...(helmet.contentSecurityPolicy.getDefaultDirectives()["connect-src"] ?? ["'self'"]),
          "https://challenges.cloudflare.com",
        ],
        "style-src-attr": ["'unsafe-inline'"],
      },
    },
  }),
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }),
);
app.post(
  "/api/webhooks/turnkey",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await receiveTurnkeyWebhook(
        rawBody,
        req.headers as Record<string, string | string[] | undefined>,
      );
      if (!result.accepted) {
        return res.status(result.status).json({ success: false, error: result.error });
      }
      return res.status(200).json({
        success: true,
        received: true,
        duplicate: result.duplicate,
        eventId: result.eventId,
      });
    } catch (error) {
      console.error("Turnkey webhook persistence failed", error);
      return res.status(503).json({ success: false, error: "TURNKEY_WEBHOOK_TEMPORARILY_UNAVAILABLE" });
    }
  },
);

// Register the raw-body webhook route before the JSON parser because Turnkey
// signatures must be verified against the exact original request bytes.
app.use(express.json({ limit: "2mb" }));

const authLimiter = rateLimit({
  store: new PostgresRateLimitStore("auth:"),
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "TOO_MANY_REQUESTS" },
});

const answerLimiter = rateLimit({
  store: new PostgresRateLimitStore("contest-answer:"),
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
  "polygon-ecosystem-token", "tether", "usd-coin", "ethereum",
  "binancecoin", "tron", "ripple", "dogecoin", "cardano",
  "avalanche-2", "chainlink", "dai", "litecoin", "polkadot", "stellar",
];
const marketPriceCacheSettingKey = "market_prices_cache_v1";
const marketPriceCacheMaxAgeMs = 24 * 60 * 60 * 1000;
let cachedMarketPrices: Record<string, number> | null = null;
let marketPricesUpdatedAt: number | null = null;
let marketPricesCacheExpiresAt = 0;
let marketPriceCacheRestore: Promise<void> | null = null;

async function restoreMarketPriceCache(): Promise<void> {
  if (!marketPriceCacheRestore) {
    marketPriceCacheRestore = (async () => {
      try {
        const setting = await prisma.systemSetting.findUnique({
          where: { key: marketPriceCacheSettingKey },
        });
        if (!setting) return;
        const parsed = JSON.parse(setting.value) as {
          prices?: unknown;
          updatedAt?: unknown;
        };
        if (!parsed.prices || typeof parsed.prices !== "object" || Array.isArray(parsed.prices)) return;
        const prices: Record<string, number> = {};
        for (const [id, value] of Object.entries(parsed.prices)) {
          if (marketPriceIds.includes(id) && typeof value === "number" && Number.isFinite(value) && value > 0) {
            prices[id] = value;
          }
        }
        if (Object.keys(prices).length > 0 && typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)) {
          cachedMarketPrices = prices;
          marketPricesUpdatedAt = parsed.updatedAt;
          marketPricesCacheExpiresAt = 0;
        }
      } catch (error) {
        console.warn("Unable to restore persisted market price cache", error);
      }
    })();
  }
  await marketPriceCacheRestore;
}

async function fetchCoinGeckoMarketPrices(): Promise<Record<string, number>> {
  const upstream = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=" +
      marketPriceIds.join(",") + "&vs_currencies=usd",
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
  );
  if (!upstream.ok) throw new Error("COINGECKO_HTTP_" + upstream.status);

  const payload: unknown = await upstream.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("INVALID_COINGECKO_RESPONSE");
  }

  const prices: Record<string, number> = {};
  for (const id of marketPriceIds) {
    const quote = (payload as Record<string, unknown>)[id];
    if (quote && typeof quote === "object" && !Array.isArray(quote)) {
      const usd = (quote as Record<string, unknown>).usd;
      if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) prices[id] = usd;
    }
  }
  if (Object.keys(prices).length === 0) throw new Error("EMPTY_COINGECKO_RESPONSE");
  return prices;
}

// Independent fallback for POL. Binance's POL/USDT spot quote is used as an
// estimated USD quote (USDT is treated at its USD peg); it is never used for
// wallet accounting, deposits, withdrawals, or settlement.
async function fetchBinancePolFallback(): Promise<number> {
  const upstream = await fetch(
    "https://api.binance.com/api/v3/ticker/price?symbol=POLUSDT",
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) },
  );
  if (!upstream.ok) throw new Error("BINANCE_HTTP_" + upstream.status);
  const payload: unknown = await upstream.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("INVALID_BINANCE_RESPONSE");
  }
  const rawPrice = (payload as Record<string, unknown>).price;
  const price = typeof rawPrice === "string" ? Number(rawPrice) : rawPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error("INVALID_BINANCE_POL_PRICE");
  }
  return price;
}

const marketPriceLimiter = rateLimit({
  store: new PostgresRateLimitStore("market-price:"),
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "TOO_MANY_REQUESTS" },
});

app.get("/api/market/prices", marketPriceLimiter, async (_req, res) => {
  await restoreMarketPriceCache();
  const now = Date.now();
  if (cachedMarketPrices && now < marketPricesCacheExpiresAt) {
    return res.json({
      success: true,
      data: { prices: cachedMarketPrices, updatedAt: marketPricesUpdatedAt, source: "server-cache" },
    });
  }

  const freshPrices: Record<string, number> = {};
  const sources: string[] = [];

  try {
    Object.assign(freshPrices, await fetchCoinGeckoMarketPrices());
    sources.push("coingecko");
  } catch (error) {
    console.warn("CoinGecko market price provider failed", error);
  }

  if (freshPrices["polygon-ecosystem-token"] === undefined) {
    try {
      freshPrices["polygon-ecosystem-token"] = await fetchBinancePolFallback();
      sources.push("binance-pol-fallback");
    } catch (error) {
      console.warn("Binance POL fallback provider failed", error);
    }
  }

  if (Object.keys(freshPrices).length > 0) {
    const mergedPrices = freshPrices;
    const updatedAt = Date.now();
    cachedMarketPrices = mergedPrices;
    marketPricesUpdatedAt = updatedAt;
    marketPricesCacheExpiresAt = updatedAt + 60_000;

    try {
      await prisma.systemSetting.upsert({
        where: { key: marketPriceCacheSettingKey },
        update: { value: JSON.stringify({ prices: mergedPrices, updatedAt }) },
        create: {
          key: marketPriceCacheSettingKey,
          value: JSON.stringify({ prices: mergedPrices, updatedAt }),
        },
      });
    } catch (error) {
      console.warn("Unable to persist market price cache", error);
    }

    return res.json({
      success: true,
      data: {
        prices: mergedPrices,
        updatedAt,
        source: sources.join("+") || "server-cache",
      },
    });
  }

  if (
    cachedMarketPrices &&
    marketPricesUpdatedAt !== null &&
    now - marketPricesUpdatedAt <= marketPriceCacheMaxAgeMs
  ) {
    return res.json({
      success: true,
      data: {
        prices: cachedMarketPrices,
        updatedAt: marketPricesUpdatedAt,
        source: "persistent-cache",
        stale: true,
      },
    });
  }

  return res.status(503).json({ success: false, error: "PRICE_FEED_UNAVAILABLE" });
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
