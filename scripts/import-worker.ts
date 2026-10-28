import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getImportQueue } from "../src/features/imports/queue";
import { processImport } from "../src/features/imports/runner";

const queue = await getImportQueue();
await queue.work<{ id: string }>("valweb-import", { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: 1 }, async jobs => {
  for (const job of jobs) await processImport(job.data.id);
});
async function recoverQueued(includeInterrupted = false) {
  const pending = await prisma.importJob.findMany({ where: { status: { in: includeInterrupted ? ["QUEUED", "PROCESSING"] : ["QUEUED"] } }, select: { id: true }, take: 100, orderBy: { createdAt: "asc" } });
  for (const job of pending) await queue.send("valweb-import", { id: job.id }, { singletonKey: job.id });
}
await recoverQueued(true);
const recovery = setInterval(() => { void recoverQueued().catch(() => console.error("IMPORT_RECOVERY_FAILED")); }, 30000);
console.info("Worker de importaciones listo: un lote a la vez.");
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(recovery);
  // Drain the current import before pg-boss's bounded shutdown can interrupt it.
  await queue.offWork("valweb-import", { wait: true });
  await queue.stop({ graceful: true });
  await prisma.$disconnect();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void shutdown().catch(() => { console.error("IMPORT_SHUTDOWN_FAILED"); process.exit(1); }); });
