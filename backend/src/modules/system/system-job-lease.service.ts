import { randomUUID } from "node:crypto";
import prisma from "../../config/prisma.js";

type LeaseUpdateResult = { count: number };

export type SystemJobLeaseStore = {
  upsert(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<LeaseUpdateResult>;
};

type LeaseOptions = {
  leaseMs?: number;
  store?: SystemJobLeaseStore;
};

export type LeaseRunResult<T> =
  | { acquired: false }
  | { acquired: true; value: T };

const DEFAULT_LEASE_MS = 120_000;
const activeWorkerTasks = new Set<Promise<unknown>>();

function asLeaseStore(store?: SystemJobLeaseStore): SystemJobLeaseStore {
  return store ?? (prisma.systemJobLease as unknown as SystemJobLeaseStore);
}

/**
 * Runs a periodic background task only while this process owns its durable
 * PostgreSQL lease. All API replicas and Worker replicas coordinate through
 * the same row; no process-local mutex is treated as globally authoritative.
 *
 * The lease is renewed while the task is active and is released with an
 * owner-checked update, so a stale process cannot release another process's
 * lease after its own lease has expired.
 */
export async function runWithSystemJobLease<T>(
  name: string,
  task: () => Promise<T>,
  options: LeaseOptions = {},
): Promise<LeaseRunResult<T>> {
  const leaseMs = Math.max(5_000, Math.floor(options.leaseMs ?? DEFAULT_LEASE_MS));
  const store = asLeaseStore(options.store);
  const owner = randomUUID();
  const now = new Date();

  await store.upsert({
    where: { name },
    update: {},
    create: {
      name,
      owner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
    },
  });

  const claimed = await store.updateMany({
    where: {
      name,
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      owner,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      heartbeatAt: now,
    },
  });

  if (claimed.count !== 1) return { acquired: false };

  let leaseLost = false;
  let heartbeatInFlight = false;
  const heartbeatIntervalMs = Math.max(1_000, Math.floor(leaseMs / 3));

  const heartbeat = setInterval(() => {
    if (heartbeatInFlight || leaseLost) return;
    heartbeatInFlight = true;
    void store.updateMany({
      where: { name, owner },
      data: {
        leaseExpiresAt: new Date(Date.now() + leaseMs),
        heartbeatAt: new Date(),
      },
    }).then((result) => {
      if (result.count !== 1) {
        leaseLost = true;
        console.error("Background worker lost its database lease", { job: name });
      }
    }).catch((error) => {
      leaseLost = true;
      console.error("Could not renew background worker lease", { job: name, error });
    }).finally(() => {
      heartbeatInFlight = false;
    });
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  const running = Promise.resolve().then(task);
  activeWorkerTasks.add(running);

  try {
    const value = await running;
    if (leaseLost) throw new Error("SYSTEM_JOB_LEASE_LOST");
    return { acquired: true, value };
  } finally {
    activeWorkerTasks.delete(running);
    clearInterval(heartbeat);
    try {
      await store.updateMany({
        where: { name, owner },
        data: {
          owner: null,
          leaseExpiresAt: null,
          heartbeatAt: new Date(),
        },
      });
    } catch (error) {
      // The lease expires automatically if release fails; never mask the task
      // result or error with a cleanup failure.
      console.error("Could not release background worker lease", { job: name, error });
    }
  }
}

/** Wait for currently leased in-flight jobs during SIGTERM/SIGINT shutdown. */
export async function waitForActiveWorkerTasks(timeoutMs = 25_000): Promise<boolean> {
  if (activeWorkerTasks.size === 0) return true;
  const tasks = [...activeWorkerTasks];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    Promise.allSettled(tasks).then(() => false),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(true), Math.max(0, timeoutMs));
      timeout.unref?.();
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  return !timedOut;
}
