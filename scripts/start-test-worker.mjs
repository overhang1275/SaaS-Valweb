import "dotenv/config";
import { resolve } from "node:path";
if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
Object.assign(process.env, {
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  NEXTAUTH_URL: "http://localhost:3001",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "2525",
  SMTP_FROM: "Valweb <noreply@example.test>",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  IMAGE_STORAGE_DIR: resolve("var/test-assets"),
  IMPORT_STORAGE_DIR: resolve("var/test-imports"),
});
await import("./import-worker.ts");
