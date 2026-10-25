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

const app = express();
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
