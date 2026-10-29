import { createRequire } from "node:module";
import { access, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";

const load = createRequire(import.meta.url);
const { Pool } = load("pg");
const dotenv = load("dotenv");

async function main() {
  const configPath = process.argv[2];
  if (!configPath) throw new Error("Missing configuration file");
  dotenv.config({ path: configPath, override: true, quiet: true });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const table = 'public."ImageStorageLocation"';
    const check = await pool.query("SELECT to_regclass($1) IS NOT NULL AS present", [table]);
    if (!check.rows[0].present) return [];
    const { rows } = await pool.query('SELECT "kind", "rootPath" FROM "ImageStorageLocation"');
    for (const row of rows) {
      if (!isAbsolute(row.rootPath)) throw new Error("Storage path is not absolute");
      await access(row.rootPath, constants.R_OK | constants.X_OK);
      const info = await statfs(row.rootPath);
      if (row.kind === "NFS" && info.type !== 0x6969) throw new Error("NFS is unavailable");
    }
    return rows.map(row => row.rootPath);
  } finally {
    await pool.end();
  }
}

main().then(paths => process.stdout.write(`${JSON.stringify(paths)}\n`)).catch(() => {
  console.error("No se pudieron verificar los destinos de imágenes para el respaldo.");
  process.exitCode = 1;
});
