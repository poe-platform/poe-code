import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRegularInput } from "./typecheck-integration-inputs.mjs";

const sourceDirectory = "src/commands/bytes/compression/native";
const names = ["bz2", "xz", "zstd"];

export async function copyCompressionAssets({
  root = fileURLToPath(new URL("../", import.meta.url)),
  fileSystem = fs,
} = {}) {
  root = resolve(root);
  assert.ok(fileSystem.lstatSync(root).isDirectory(), "codec package root must be a directory");
  const read = (path, maximum) => readRegularInput(root, `${sourceDirectory}/${path}`, maximum, fileSystem);
  const manifestBytes = read("sources.json", 65536);
  const manifest = JSON.parse(manifestBytes);
  assert.ok(Array.isArray(manifest.artifacts), "missing codec artifact paths");
  assert.deepEqual(manifest.artifacts.map(entry => entry.path).sort(), names.map(name => `generated/${name}.mjs`).sort(), "unexpected codec artifact paths");
  const admitted = new Map([["sources.json", manifestBytes], ["LICENSES.txt", read("LICENSES.txt", 524288)]]);
  for (const artifact of manifest.artifacts) {
    assert.ok(Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= 4194304, "invalid codec artifact size");
    const bytes = read(artifact.path, artifact.bytes);
    assert.equal(bytes.length, artifact.bytes, "codec artifact size mismatch");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256, "codec artifact digest mismatch");
    admitted.set(artifact.path, bytes);
  }
  for (const name of names) admitted.set(`generated/${name}.d.mts`, read(`generated/${name}.d.mts`, 32768));

  const output = "dist/commands/bytes/compression/native";
  for (const path of admitted.keys()) {
    let directory = root;
    for (const component of `${output}/${path}`.split("/").slice(0, -1)) {
      directory = join(directory, component);
      try { fileSystem.mkdirSync(directory); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      assert.ok(fileSystem.lstatSync(directory).isDirectory(), "codec output ancestor must be a directory");
    }
    const destination = join(root, output, path);
    try {
      const stat = fileSystem.lstatSync(destination);
      assert.ok(stat.isFile() && stat.nlink === 1, "codec output must be a regular single-link file");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const flags = fileSystem.constants;
  for (const [path, bytes] of admitted) {
    const descriptor = fileSystem.openSync(join(root, output, path), flags.O_WRONLY | flags.O_CREAT | flags.O_NOFOLLOW | flags.O_NONBLOCK, 0o644);
    try {
      const stat = fileSystem.fstatSync(descriptor);
      assert.ok(stat.isFile() && stat.nlink === 1, "codec output must be a regular single-link file");
      fileSystem.ftruncateSync(descriptor, 0);
      fileSystem.writeFileSync(descriptor, bytes);
    } finally { fileSystem.closeSync(descriptor); }
  }
  return [...admitted.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await copyCompressionAssets({ root: resolve(dirname(fileURLToPath(import.meta.url)), "..") });
}
