import { afterEach, beforeEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, readlink, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = await readFile(new URL("../../ops/valweb-install.sh", import.meta.url), "utf8");
// Load the real functions without running package installation or system configuration.
const boundary = source.indexOf('\n[[ ${1:-} == --help');
if (boundary < 0) throw new Error("Installer command boundary not found; refusing to execute it in tests.");
const functions = source.slice(0, boundary);
const installed = "a".repeat(40), candidate = "b".repeat(40), obsolete = "c".repeat(40);
let app: string, releases: string;

beforeEach(async () => {
  app = await mkdtemp(join(tmpdir(), "valweb-releases-"));
  releases = join(app, "releases");
  for (const name of [installed, candidate, obsolete]) await mkdir(join(releases, name), { recursive: true });
  await symlink(join(releases, installed), join(app, "current"));
});
afterEach(async () => { await rm(app, { recursive: true, force: true }); });

function run(target = candidate, cwd = app, action = 'prune_releases "$2" "$3"', storage = "") {
  return spawnSync("bash", ["-c", `${functions}\nAPP=$1\nRELEASES=$APP/releases\n${action}`, "installer-test", app, target, storage], { cwd, encoding: "utf8" });
}

it("removes obsolete releases while keeping the installed and candidate versions and external configuration", async () => {
  await writeFile(join(app, "config.env"), "configuration must survive");
  await symlink(join(app, "config.env"), join(releases, obsolete, ".env"));
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect((await readdir(releases)).sort()).toEqual([installed, candidate]);
  expect(await readlink(join(app, "current"))).toBe(join(releases, installed));
  expect(await readFile(join(app, "config.env"), "utf8")).toBe("configuration must survive");
});

it("keeps only the candidate when there is no installed version", async () => {
  await unlink(join(app, "current"));
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(await readdir(releases)).toEqual([candidate]);
});

it("does not remove an installed version when it is also the selected candidate", async () => {
  const result = run(installed);
  expect(result.status, result.stderr).toBe(0);
  expect(await readdir(releases)).toEqual([installed]);
});

it("leaves unknown directories and release symlinks untouched", async () => {
  const external = join(app, "external");
  await mkdir(external);
  await writeFile(join(external, "image.png"), "image must survive");
  await symlink(external, join(releases, "d".repeat(40)));
  await mkdir(join(releases, "manual-backup"));
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(await readFile(join(external, "image.png"), "utf8")).toBe("image must survive");
  expect((await readdir(releases)).sort()).toEqual([installed, candidate, "d".repeat(40), "manual-backup"]);
});

it.each(["var", "uploads", "storage", "backups", "dumps"])("refuses to delete a release containing persistent %s data", async directory => {
  await mkdir(join(releases, obsolete, directory));
  await writeFile(join(releases, obsolete, directory, "original"), "keep");
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/datos persistentes/i);
  expect(await readFile(join(releases, obsolete, directory, "original"), "utf8")).toBe("keep");
});

it("validates all obsolete releases before deleting any of them", async () => {
  await mkdir(join(releases, "d".repeat(40), "var"), { recursive: true });
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/datos persistentes/i);
  expect(await readdir(join(releases, obsolete))).toEqual([]);
});

it("protects a configured image or import destination inside an obsolete release", async () => {
  const storage = join(releases, obsolete, "private-images");
  await mkdir(storage);
  await writeFile(join(storage, "original.png"), "keep");
  const result = run(candidate, app, 'prune_releases "$2" "$3"', storage);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/datos persistentes/i);
  expect(await readFile(join(storage, "original.png"), "utf8")).toBe("keep");
});

it("preserves a configured storage symlink inside an obsolete release", async () => {
  const external = join(app, "private-images");
  await mkdir(external);
  const storage = join(releases, obsolete, "images-link");
  await symlink(external, storage);
  const result = run(candidate, app, 'prune_releases "$2" "$3"', storage);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/datos persistentes/i);
  expect(await readlink(storage)).toBe(external);
});

it.each(["../outside", "latest"])("refuses invalid candidate %s without removing releases", async target => {
  const result = run(target);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/commit candidato/i);
  expect((await readdir(releases)).sort()).toEqual([installed, candidate, obsolete]);
});

it("refuses to delete a release being used as a process working directory", async () => {
  const result = run(candidate, join(releases, obsolete));
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/proceso/i);
  expect(await readdir(join(releases, obsolete))).toEqual([]);
});

it("refuses to prune through a symlinked releases directory", async () => {
  const external = join(app, "external-releases");
  await rename(releases, external);
  await symlink(external, releases);
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/enlace/i);
  expect((await readdir(external)).sort()).toEqual([installed, candidate, obsolete]);
});

it("refuses to prune when the current version points outside managed releases", async () => {
  await mkdir(join(app, "external"));
  await unlink(join(app, "current"));
  await symlink(join(app, "external"), join(app, "current"));
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/versión actual/i);
  expect((await readdir(releases)).sort()).toEqual([installed, candidate, obsolete]);
});

it("can restore the previous version after switching to a failing candidate", async () => {
  const result = run(candidate, app, `OLD_LINK=$(readlink -f "$APP/current")
prune_releases "$2"
ln -sfn "$RELEASES/$2" "$APP/current"
SWITCHED=1
recover`);
  expect(result.status, result.stderr).toBe(0);
  expect(await readlink(join(app, "current"))).toBe(join(releases, installed));
  expect((await readdir(releases)).sort()).toEqual([installed, candidate]);
});
