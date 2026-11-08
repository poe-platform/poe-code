import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFsFromVolume, Volume } from "memfs";

export function createRunMemoryFileSystem() {
  const fixtureRoot = fileURLToPath(new URL("../src/__fixtures__", import.meta.url));
  const volume = new Volume();
  const copy = (directory: string) => {
    volume.mkdirSync(directory, { recursive: true });
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) copy(target);
      else if (entry.isFile()) volume.writeFileSync(target, readFileSync(target));
    }
  };
  copy(path.join(fixtureRoot, "source"));
  copy(path.join(fixtureRoot, "clone-target"));
  volume.mkdirSync(tmpdir(), { recursive: true });
  return createFsFromVolume(volume).promises;
}
