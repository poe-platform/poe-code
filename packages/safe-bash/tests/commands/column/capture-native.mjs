import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, unlink, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arch, release, platform } from "node:os";

const directory = dirname(fileURLToPath(import.meta.url));
const binary = "/usr/bin/column";
const pinnedBinaryHash = "c6d7b469d8e8437c7185bedd356626ca69867c9c6b002cbb0020d995a6e4cc5f";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(await readFile(binary)), pinnedBinaryHash, "wrong native oracle binary; do not overwrite the pinned cohort");
const fixtureBytes = await readFile(join(directory, "cases.json"));
const fixtures = JSON.parse(fixtureBytes);
const invoke = (args, input = Buffer.alloc(0), extra = {}) => {
  const result = spawnSync(binary, args, { input, env: { LC_ALL: "C", COLUMNS: "80" }, timeout: 5000, maxBuffer: 1024 * 1024, ...extra });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { status: result.status, signal: result.signal, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex") };
};
const records = [];
for (const fixture of fixtures) {
  const scratch = await mkdtemp(join(directory, ".native-"));
  const created = [];
  try {
    for (const [name, content] of Object.entries(fixture.files ?? {})) {
      assert.ok(name && !name.includes("/") && name !== "." && name !== "..");
      const path = join(scratch, name);
      await writeFile(path, content, { flag: "wx" });
      created.push(path);
    }
    const stdin = fixture.inputHex === undefined ? Buffer.from(fixture.input ?? "") : Buffer.from(fixture.inputHex, "hex");
    const env = { LC_ALL: fixture.locale ?? "C", COLUMNS: "80" };
    records.push({ id: fixture.id, profile: fixture.profile, argv: fixture.args, env, stdinHex: stdin.toString("hex"), filesHex: Object.fromEntries(Object.entries(fixture.files ?? {}).map(([name, text]) => [name, Buffer.from(text).toString("hex")])), ...invoke(fixture.args, stdin, { cwd: scratch, env }) });
  } finally {
    for (const path of created) await unlink(path);
    await rmdir(scratch);
  }
}
const captured = {
  classification: "native-oracle records; JSON bytes are data, not canonical TypeScript inputs",
  capturedAt: new Date().toISOString(),
  oracle: { binary, sha256: pinnedBinaryHash, profile: "Apple/Darwin BSD column, NOT GNU or util-linux", versionProbe: { argv: ["-V"], ...invoke(["-V"]) }, manSha256: hash(await readFile("/usr/share/man/man1/column.1")), manVersion: "Berkeley 8.1 1993-06-06; document date July 29, 2004; no program version option", platform: platform(), release: release(), arch: arch(), swVers: spawnSync("/usr/bin/sw_vers", [], { encoding: "utf8" }).stdout },
  fixtureSha256: hash(fixtureBytes),
  records,
};
const destination = join(directory, "native.json");
if (process.argv.includes("--verify")) {
  const saved = JSON.parse(await readFile(destination, "utf8"));
  assert.equal(saved.fixtureSha256, captured.fixtureSha256);
  assert.deepEqual(captured.records, saved.records);
  console.log(`Verified ${records.length} live pinned BSD records (parity denominator is only the exact cohort).`);
} else {
  await writeFile(destination, `${JSON.stringify(captured, null, 2)}\n`, { flag: "wx" });
  console.log(`Captured ${records.length} raw pinned BSD records; no previous cohort overwritten.`);
}
