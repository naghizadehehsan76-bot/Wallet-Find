import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import prisma from "../../config/prisma.js";
import { runWithSystemJobLease } from "./system-job-lease.service.js";

const shouldRun = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (shouldRun) await prisma.$disconnect();
});

test("PostgreSQL lease admits one worker under concurrent replica claims and recovers expired leases", {
  skip: !shouldRun,
  timeout: 60_000,
}, async () => {
  const name = "ci-concurrent-worker-" + randomUUID();
  let executions = 0;
  try {
    const claims = await Promise.all(Array.from({ length: 20 }, () =>
      runWithSystemJobLease(name, async () => {
        executions += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return "processed";
      }, { leaseMs: 5_000 }),
    ));

    assert.equal(claims.filter((claim) => claim.acquired).length, 1);
    assert.equal(executions, 1);

    await prisma.systemJobLease.update({
      where: { name },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    const recovered = await runWithSystemJobLease(name, async () => "recovered", { leaseMs: 5_000 });
    assert.deepEqual(recovered, { acquired: true, value: "recovered" });
  } finally {
    await prisma.systemJobLease.deleteMany({ where: { name } });
  }
});
