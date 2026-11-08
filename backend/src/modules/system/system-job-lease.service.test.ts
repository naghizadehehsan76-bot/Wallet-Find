import test from "node:test";
import assert from "node:assert/strict";
import {
  runWithSystemJobLease,
  type SystemJobLeaseStore,
} from "./system-job-lease.service.js";

type LeaseRecord = {
  owner: string | null;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
};

class FakeLeaseStore implements SystemJobLeaseStore {
  private readonly rows = new Map<string, LeaseRecord>();

  async upsert(input: unknown): Promise<unknown> {
    const args = input as { where: { name: string }; create: LeaseRecord };
    if (!this.rows.has(args.where.name)) this.rows.set(args.where.name, args.create);
    return this.rows.get(args.where.name);
  }

  async updateMany(input: unknown): Promise<{ count: number }> {
    const args = input as {
      where: {
        name: string;
        owner?: string;
        OR?: Array<{ leaseExpiresAt: null | { lt: Date } }>;
      };
      data: Partial<LeaseRecord>;
    };
    const row = this.rows.get(args.where.name);
    if (!row) return { count: 0 };

    if (args.where.owner !== undefined && row.owner !== args.where.owner) {
      return { count: 0 };
    }

    if (args.where.OR) {
      const now = new Date();
      const canClaim = args.where.OR.some((condition) => {
        const expected = condition.leaseExpiresAt;
        if (expected === null) return row.leaseExpiresAt === null;
        return row.leaseExpiresAt !== null && row.leaseExpiresAt < expected.lt;
      });
      if (!canClaim) return { count: 0 };
    }

    Object.assign(row, args.data);
    return { count: 1 };
  }
}

test("only one process can acquire the same distributed job lease at a time", async () => {
  const store = new FakeLeaseStore();
  let executions = 0;

  const task = async () => {
    executions += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return "done";
  };

  const results = await Promise.all([
    runWithSystemJobLease("scheduler", task, { store, leaseMs: 5_000 }),
    runWithSystemJobLease("scheduler", task, { store, leaseMs: 5_000 }),
  ]);

  assert.equal(results.filter((result) => result.acquired).length, 1);
  assert.equal(executions, 1);
});

test("the lease is released after completion so a later process can run", async () => {
  const store = new FakeLeaseStore();
  const first = await runWithSystemJobLease("settlement", async () => 1, { store, leaseMs: 5_000 });
  const second = await runWithSystemJobLease("settlement", async () => 2, { store, leaseMs: 5_000 });

  assert.deepEqual(first, { acquired: true, value: 1 });
  assert.deepEqual(second, { acquired: true, value: 2 });
});

test("a failed lease heartbeat marks the worker unsafe and allows recovery", async () => {
  class HeartbeatFailureStore extends FakeLeaseStore {
    async updateMany(input: unknown): Promise<{ count: number }> {
      const args = input as {
        where: { owner?: string; OR?: unknown };
        data: { owner?: string | null; leaseExpiresAt?: Date | null };
      };
      if (args.where.owner && args.data.leaseExpiresAt instanceof Date && !args.where.OR) {
        throw new Error("CI_INJECTED_DATABASE_INTERRUPTION");
      }
      return super.updateMany(input);
    }
  }

  const store = new HeartbeatFailureStore();
  await assert.rejects(
    runWithSystemJobLease(
      "heartbeat-fault-injection",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 2_200));
        return "must-not-be-reported-as-safe";
      },
      { store, leaseMs: 5_000 },
    ),
    /SYSTEM_JOB_LEASE_LOST/,
  );

  const recovered = await runWithSystemJobLease(
    "heartbeat-fault-injection",
    async () => "recovered",
    { store, leaseMs: 5_000 },
  );
  assert.deepEqual(recovered, { acquired: true, value: "recovered" });
});
