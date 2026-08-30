import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import * as root from "./.oracle/build-snapshot/dist/index.js";
import * as metadata from "./.oracle/build-snapshot/dist/commands/metadata/index.js";

test("built public root/subpath expose identical metadata factories", () => {
  assert.equal(root.metadataCommands, metadata.metadataCommands);
  assert.equal(root.createMetadataCommands, metadata.createMetadataCommands);
  assert.deepEqual(metadata.createMetadataCommands().map(command => command.name), ["chmod", "stat", "mktemp"]);
});

test("built aggregate retains 52 defaults and optional tools stay optional", () => {
  const names = root.createAgentCommands().map(command => command.name);
  assert.equal(names.length, 52);
  assert.equal(new Set(names).size, 52);
  for (const optional of ["curl", "safejs", "tar"]) assert.equal(names.includes(optional), false);
});

test("built metadata plugin runs shell substitution redirects and pipeline", async () => {
  const fs = root.createMemoryFileSystem();
  await fs.mkdir("/tmp");
  const shell = new root.Shell({ fs }).use(root.standardCommands()).use(metadata.metadataCommands());
  try {
    const result = await shell.exec('file=$(mktemp); printf payload > "$file"; chmod 600 "$file"; stat --printf="[%08.4s]:[%+04a]\\n" "$file" | cat');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "[    0007]:[0600]\n");
    assert.equal(result.stderr, "");
    const entries = await fs.readdir("/tmp");
    assert.equal(entries.length, 1);
    assert.equal(Buffer.from(await fs.readFile(`/tmp/${entries[0].name}`)).toString(), "payload");
  } finally { await shell.dispose(); }
});

test("built stat preserves millisecond epoch formatting through public Shell", async () => {
  const fs = root.createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1));
  await fs.utimes("/file", 1001, -1);
  const shell = new root.Shell({ fs }).use(metadata.metadataCommands());
  try {
    const result = await shell.exec("stat --printf='%.3X:%.3Y' /file");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "1.001:-0.001");
  } finally { await shell.dispose(); }
});

test("built manifest retains zero runtime dependencies and actual export files", async () => {
  const manifestUrl = new URL("./.oracle/build-snapshot/package.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) assert.deepEqual(Object.keys(manifest[field] ?? {}), []);
  for (const entry of Object.values(manifest.exports)) {
    const names = entry.import.includes("*")
      ? (await readdir(new URL(entry.import.slice(0, entry.import.lastIndexOf("/") + 1), manifestUrl))).filter(name => name.endsWith(".js")).map(name => name.slice(0, -3))
      : [""];
    assert.ok(names.length > 0);
    for (const name of names) {
      assert.ok((await readFile(new URL(entry.import.replace("*", name), manifestUrl))).length > 0);
      assert.ok((await readFile(new URL(entry.types.replace("*", name), manifestUrl))).length > 0);
    }
  }
});
