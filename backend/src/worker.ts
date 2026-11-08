import "dotenv/config";
import { getRuntimeRole } from "./config/runtime-role.js";
import prisma from "./config/prisma.js";
import { startBackgroundWorkers, type BackgroundWorkersHandle } from "./modules/system/background-workers.js";
import { waitForActiveWorkerTasks } from "./modules/system/system-job-lease.service.js";

const role = getRuntimeRole(process.env.APP_ROLE, "worker");
if (role !== "worker") {
  throw new Error("The Worker entrypoint requires APP_ROLE=worker");
}

let workers: BackgroundWorkersHandle | null = null;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Worker received ${signal}; stopping new scheduled work`);
  workers?.stop();

  const drained = await waitForActiveWorkerTasks(25_000);
  if (!drained) console.error("Worker shutdown deadline reached while jobs were still active");

  await prisma.$disconnect();
  process.exitCode = drained ? 0 : 1;
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });

workers = await startBackgroundWorkers();
if (shuttingDown) workers.stop();
console.log("Wallet-Find background Worker started");
