import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import * as native from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { files, run } from "./helpers.js";

const directory = fileURLToPath(new URL(".", import.meta.url));
const executable = fileURLToPath(new URL("../metadata-stress/.oracle/coreutils-9.7/src/split", import.meta.url));

test("GNU size spellings and empty-input output-directory controls", async context => {
  try { await native.access(executable); } catch { context.skip("pinned GNU oracle unavailable"); return; }
  const evidence: unknown[] = [];
  let failed = false;
  for (const size of ["1g", "1t", "1p", "1e", "1z", "1y", "1r", "1q", "1B", "1mB", "1miB", "+K", " K", "K", " +2", "0K"]) {
    const args = ["-b", size];
    const expected = spawnSync(executable, args, { input: Buffer.alloc(0), env: { LC_ALL: "C", PATH: "/usr/bin:/bin" } });
    const observed = await run(args);
    const match = expected.status === observed.exitCode;
    failed ||= !match;
    evidence.push({ id: `size-${size}`, args, expected: { status: expected.status, stderr: expected.stderr.toString() }, observed: { status: observed.exitCode, stderr: observed.stderr }, semanticMatch: match });
  }
  for (const named of [false, true]) {
    const temp = await native.mkdtemp(join(directory, ".native-empty-"));
    const fs = createMemoryFileSystem();
    await native.mkdir(join(temp, "xaa"));
    await fs.mkdir("/xaa");
    if (named) { await native.writeFile(join(temp, "input"), ""); await fs.writeFile("/input", Buffer.alloc(0)); }
    const args = named ? ["input"] : [];
    const expected = spawnSync(executable, args, { cwd: temp, input: Buffer.alloc(0), env: { LC_ALL: "C", PATH: "/usr/bin:/bin" } });
    const observed = await run(args, "", {}, { fs });
    const match = expected.status === observed.exitCode && expected.stderr.toString() === observed.stderr;
    failed ||= !match;
    evidence.push({ id: `empty-output-directory-${named ? "file" : "stdin"}`, args, expected: { status: expected.status, stderr: expected.stderr.toString() }, observed: { status: observed.exitCode, stderr: observed.stderr, files: await files(fs) }, semanticMatch: match });
    await native.rm(temp, { recursive: true });
  }
  await native.mkdir(join(directory, "evidence"), { recursive: true });
  const json = JSON.stringify({ profile: "GNU9.7 Darwin LC_ALL=C", evidence, failed }, null, 2) + "\n";
  try { await native.writeFile(join(directory, "evidence/edge-initial.json"), json, { flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await native.writeFile(join(directory, "evidence/edge-latest.json"), json);
  assert.equal(failed, false, "size/empty controls failed; raw initial evidence retained");
});
