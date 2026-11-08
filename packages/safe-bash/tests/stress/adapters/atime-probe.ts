import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as native from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRealFileSystem } from "../../../src/fs/real/index.js";

const root = await native.mkdtemp(join(tmpdir(), "virtual-bash-atime-probe-"));
const binary = Uint8Array.from({ length: 4099 }, (_, index) => index % 256);
const iterationsPerBackend = 500;
const futureAtimeMs = (Math.floor(Date.now() / 1000) + 86400) * 1000;
const fixtures = [
  { name: "historical-diagnostic", atimeMs: 10000, mtimeMs: 20000 },
  { name: "future-exact-control", atimeMs: futureAtimeMs, mtimeMs: 20000 },
  { name: "future-millisecond-control", atimeMs: futureAtimeMs + 125, mtimeMs: 1_650_000_000_250 },
];
const sourcePaths = [
  "src/contracts/command.ts", "src/contracts/errors.ts", "src/contracts/filesystem.ts",
  "src/contracts/index.ts", "src/contracts/io.ts", "src/contracts/path.ts", "src/contracts/plugin.ts",
  "src/fs/real/index.ts", "tests/stress/adapters/atime-probe.ts",
];
async function sourceState() {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [
    path, createHash("sha256").update(await native.readFile(new URL(`../../../${path}`, import.meta.url))).digest("hex"),
  ])));
}
const sourceSha256Before = await sourceState();
const results: {
  fixture: string; backend: string; expectedAtimeMs: number; expectedMtimeMs: number;
  observations: Record<string, { samples: number; atimeMismatches: number; mtimeMismatches: number }>;
  firstMismatch?: { index: number; phase: string; atimeMs: number; mtimeMs: number };
}[] = [];
try {
  const fs = await createRealFileSystem({ root });
  for (const fixture of fixtures) {
    for (const backend of ["native", "adapter"] as const) {
      const result: (typeof results)[number] = {
        fixture: fixture.name, backend, expectedAtimeMs: fixture.atimeMs, expectedMtimeMs: fixture.mtimeMs,
        observations: {},
      };
      results.push(result);
      for (let index = 0; index < iterationsPerBackend; index++) {
        const path = `/${fixture.name}-${backend}-${index}`;
        const hostPath = join(root, path);
        const observe = async (phase: string) => {
          const stat = backend === "native" ? await native.stat(hostPath) : await fs.stat(path);
          const counts = result.observations[phase] ??= { samples: 0, atimeMismatches: 0, mtimeMismatches: 0 };
          counts.samples++;
          if (stat.atimeMs !== fixture.atimeMs) counts.atimeMismatches++;
          if (stat.mtimeMs !== fixture.mtimeMs) counts.mtimeMismatches++;
          if (stat.atimeMs !== fixture.atimeMs || stat.mtimeMs !== fixture.mtimeMs) {
            result.firstMismatch ??= { index, phase, atimeMs: stat.atimeMs, mtimeMs: stat.mtimeMs };
          }
        };
        if (backend === "native") {
          await native.writeFile(hostPath, binary);
          await native.chmod(hostPath, 0o600);
          await native.stat(hostPath);
          await native.utimes(hostPath, new Date(fixture.atimeMs), new Date(fixture.mtimeMs));
        } else {
          await fs.writeFile(path, binary);
          await fs.chmod(path, 0o600);
          await fs.stat(path);
          await fs.utimes(path, fixture.atimeMs, fixture.mtimeMs);
        }
        await observe("immediate");
        assert.deepEqual(new Uint8Array(await native.readFile(hostPath)), binary);
        await observe("after-native-read");
        assert.deepEqual(await fs.readFile(path), binary);
        await observe("after-adapter-read");
      }
    }
  }
  const sourceSha256After = await sourceState();
  console.log(JSON.stringify({
    iterationsPerBackend, futureAtimeMs, results,
    platform: process.platform, node: process.version,
    sourceSha256Before, sourceSha256After,
  }, null, 2));
  assert.deepEqual(sourceSha256After, sourceSha256Before);
  for (const result of results.filter((candidate) => candidate.fixture !== "historical-diagnostic")) {
    for (const [phase, counts] of Object.entries(result.observations)) {
      assert.equal(counts.atimeMismatches, 0, `${result.fixture} ${result.backend} ${phase} atime`);
      assert.equal(counts.mtimeMismatches, 0, `${result.fixture} ${result.backend} ${phase} mtime`);
    }
  }
} finally {
  await native.rm(root, { recursive: true, force: true });
}
