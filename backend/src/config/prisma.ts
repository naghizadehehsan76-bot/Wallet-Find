import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

function positiveInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

// Pool size is per process. Keep it bounded so adding API/Worker instances
// cannot multiply unbounded connections into PostgreSQL.
const adapter = new PrismaPg({
  connectionString,
  max: positiveInteger(process.env.DATABASE_POOL_MAX, 5, 1, 20),
  connectionTimeoutMillis: positiveInteger(process.env.DATABASE_POOL_ACQUIRE_TIMEOUT_MS, 5_000, 1_000, 30_000),
  idleTimeoutMillis: positiveInteger(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS, 10_000, 1_000, 60_000),
});

const prisma = new PrismaClient({
  adapter,
});

export default prisma;