import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import prisma from "./config/prisma.js";
import authRoutes from "./modules/auth/auth.routes.js";
import contestRoutes from "./modules/contest/contest.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import profileRoutes from "./modules/profile/profile.routes.js";

const app = express();
const corsOrigin = process.env.CORS_ORIGIN?.trim();
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !corsOrigin) {
  throw new Error("CORS_ORIGIN must be defined in production");
}

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: corsOrigin || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "32kb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const answerLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: "ok",
      project: "Wallet-Find",
    },
  });
});

app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({
      success: true,
      data: { status: "ready" },
    });
  } catch (error) {
    console.error("Readiness check failed", error);
    return res.status(503).json({
      success: false,
      error: "DATABASE_UNAVAILABLE",
    });
  }
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/contests", (req, res, next) => {
  if (req.method === "POST" && req.path.endsWith("/submit")) {
    return answerLimiter(req, res, next);
  }
  return next();
});
app.use("/api/contests", contestRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/profile", profileRoutes);

export default app;
