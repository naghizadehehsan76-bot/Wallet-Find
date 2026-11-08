import "dotenv/config";
import app from "./app.js";
import prisma from "./config/prisma.js";
import { getRuntimeRole, shouldStartBackgroundWorkers, shouldStartHttpServer } from "./config/runtime-role.js";
import { startBackgroundWorkers, type BackgroundWorkersHandle } from "./modules/system/background-workers.js";
import { waitForActiveWorkerTasks } from "./modules/system/system-job-lease.service.js";

const role = getRuntimeRole(process.env.APP_ROLE, "all");
if (!shouldStartHttpServer(role)) {
  throw new Error("APP_ROLE=worker must use the dedicated Worker entrypoint (dist/worker.js)");
}

const PORT = process.env.PORT || 3000;
const httpServer = app.listen(PORT, () => {
  console.log(`Wallet-Find API server running on port ${PORT} (APP_ROLE=${role})`);
});

let workerStartup: Promise<BackgroundWorkersHandle> | null = null;
let workers: BackgroundWorkersHandle | null = null;
let shuttingDown = false;

if (shouldStartBackgroundWorkers(role)) {
  workerStartup = startBackgroundWorkers();
  void workerStartup.then((handle) => {
    workers = handle;
    if (shuttingDown) handle.stop();
  }).catch((error) => {
    console.error("Background worker startup failed", error);
  });
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`API server received ${signal}; stopping new traffic and scheduled work`);
  workers?.stop();

  const serverClosed = new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });

  if (workerStartup) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      workerStartup.then(() => undefined).catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 20_000);
        timeout.unref?.();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    workers?.stop();
  }

  await serverClosed;
  const drained = await waitForActiveWorkerTasks(20_000);
  if (!drained) console.error("API shutdown deadline reached while background jobs were active");
  await prisma.$disconnect();
  process.exitCode = drained ? 0 : 1;
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });
