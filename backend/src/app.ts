import express from "express";
import cors from "cors";
import helmet from "helmet";

import authRoutes from "./modules/auth/auth.routes.js";
import contestRoutes from "./modules/contest/contest.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import profileRoutes from "./modules/profile/profile.routes.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      project: "Wallet Hunt",
    },
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/contests", contestRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/profile", profileRoutes);

export default app;
