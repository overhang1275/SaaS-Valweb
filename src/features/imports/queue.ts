import { PgBoss } from "pg-boss";

const globalQueue = globalThis as unknown as { valwebQueue?: Promise<PgBoss> };
export function getImportQueue() {
  if (!globalQueue.valwebQueue) globalQueue.valwebQueue = (async () => {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 3 });
    boss.on("error", () => console.error("IMPORT_QUEUE_ERROR"));
    await boss.start();
    await boss.createQueue("valweb-import", { policy: "singleton", retryLimit: 2, retryDelay: 30, expireInSeconds: 6 * 3600, heartbeatSeconds: 60 });
    return boss;
  })().catch(cause => { globalQueue.valwebQueue = undefined; throw cause; });
  return globalQueue.valwebQueue;
}
export async function enqueueImport(id: string) {
  const queue = await getImportQueue();
  await queue.send("valweb-import", { id }, { singletonKey: id });
}
