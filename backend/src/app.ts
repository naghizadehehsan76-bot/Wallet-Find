import express from "express";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./modules/auth/auth.routes.js";

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

export default app;