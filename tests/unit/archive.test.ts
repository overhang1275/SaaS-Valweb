import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { inspectImageArchive } from "../../src/features/imports/archive";

it("streams the manifest of 50,000 images and rejects ambiguous or unsafe names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "valweb-archive-"));
  try {
    execFileSync("python3", ["-c", `import zipfile,sys,os
root=sys.argv[1]
with zipfile.ZipFile(os.path.join(root,'large.zip'),'w') as z:
 for i in range(50000): z.writestr(f'A{i}.png',b'image-fixture')
with zipfile.ZipFile(os.path.join(root,'duplicate.zip'),'w') as z:
 z.writestr('a1.png',b'x'); z.writestr('A1.jpg',b'x')
with zipfile.ZipFile(os.path.join(root,'unsafe.zip'),'w') as z:
 z.writestr('../a1.png',b'x')
with zipfile.ZipFile(os.path.join(root,'excess.zip'),'w') as z:
 for i in range(50001): z.writestr(f'A{i}.png',b'x')`, directory]);
    expect(await inspectImageArchive(join(directory, "large.zip"))).toEqual({ files: 50000, bytes: 650000 });
    await expect(inspectImageArchive(join(directory, "duplicate.zip"))).rejects.toThrow("repetido");
    await expect(inspectImageArchive(join(directory, "unsafe.zip"))).rejects.toThrow();
    await expect(inspectImageArchive(join(directory, "excess.zip"))).rejects.toThrow("50000");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
