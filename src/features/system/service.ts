import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { currentActor, type Actor } from "@/features/identity/service";
import { limitRequest } from "@/features/identity/rate-limit";
import { importRoot } from "@/features/imports/files";

const unit = "valweb-imports.service";
function systemctl(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile("systemctl", ["--user", ...args], { timeout: 5000, maxBuffer: 16384 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

export async function getImportWorkerStatus() {
  if (process.env.VALWEB_TEST_INSTANCE === "1") return "unconfigured";
  try {
    const output = await systemctl(["show", unit, "--property=LoadState,ActiveState,SubState", "--no-pager"]);
    const fields = Object.fromEntries(output.trim().split("\n").map(line => line.split("=")));
    if (fields.LoadState !== "loaded") return "unconfigured";
    if (fields.ActiveState === "active" && fields.SubState === "running") return "running";
    if (["activating", "deactivating", "reloading"].includes(fields.ActiveState)) return "restarting";
    return "stopped";
  } catch { return "unavailable"; }
}

export async function getSystemStatus(actor: Actor) {
  await prisma.$transaction(tx => currentActor(tx, actor, true));
  const started = performance.now();
  const [database, worker, storage, jobs] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => Math.round(performance.now() - started)).catch(() => null),
    getImportWorkerStatus(),
    statfs(importRoot()).then(space => Math.floor(space.bavail * space.bsize / 1024 ** 3)).catch(() => null),
    prisma.importJob.groupBy({ by: ["status"], _count: true }).catch(() => null),
  ]);
  const count = (status: string) => jobs ? jobs.find(job => job.status === status)?._count ?? 0 : null;
  return { checkedAt: new Date().toISOString(), database, worker, freeGiB: storage,
    queued: count("QUEUED"), processing: count("PROCESSING"), review: count("REVIEW"), failed: count("FAILED") };
}

export async function restartImportWorker(actor: Actor) {
  await prisma.$transaction(tx => currentActor(tx, actor, true));
  const status = await getImportWorkerStatus();
  if (["unconfigured", "unavailable"].includes(status)) throw new Error("El control del procesador no está configurado en este servidor.");
  if (status === "restarting") throw new Error("El procesador ya está reiniciándose. Espera a que termine el lote actual.");
  if (!await limitRequest("system-restart", "imports", 1, 60)) throw new Error("Espera un minuto antes de volver a reiniciar el procesador.");
  await prisma.auditLog.create({ data: { actorId: actor.id, action: "IMPORT_WORKER_RESTART_REQUESTED", metadata: { service: unit } } });
  await systemctl(["--no-block", "restart", unit]);
}
