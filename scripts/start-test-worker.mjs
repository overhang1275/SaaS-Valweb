import "dotenv/config";
import { resolve } from "node:path";
if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
Object.assign(process.env, { DATABASE_URL: process.env.TEST_DATABASE_URL, IMAGE_STORAGE_DIR: resolve("var/test-assets"), IMPORT_STORAGE_DIR: resolve("var/test-imports") });
await import("./import-worker.ts");
