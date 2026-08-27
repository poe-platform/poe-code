import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { supervise } from "../supervise.mjs";

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, "../../../..");
const output = process.env.AUTHORITY_RECONCILIATION_OUTPUT ? resolve(process.env.AUTHORITY_RECONCILIATION_OUTPUT) : owned;
const revision = "26e4069";
const fixtures = [
  "tests/fs/mount/identity-authority-review/implementation/adapter-binding.test.ts",
  "tests/fs/mount/identity-authority-review/implementation/remote-comparison.test.ts",
  "tests/fs/mount/identity-authority-review/authority.test.ts",
];
const guards = [
  "tests/fs/mount/copy-identity.test.ts",
  "tests/fs/mount/copy-identity-guards.test.ts",
  "tests/fs/overlay/copy-identity.test.ts",
];
const adjacent = [
  "tests/fs/mount/identity-authority-review/implementation/core-ordering.test.ts",
  "tests/fs/mount/identity-authority-review/implementation/public-comparison.test.ts",
  "tests/fs/mount/identity-compatibility-review/compatibility.test.ts",
  "tests/fs/authority-trust-review/authority.test.ts",
  "tests/fs/s3/constructor-comparison.test.ts",
  "tests/fs/webdav/constructor-comparison.test.ts",
];
const hash = data => createHash("sha256").update(data).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const save = async (path, data) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof data === "string" || Buffer.isBuffer(data) ? data : `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
};
const evidence = join(output, "evidence");
const sessionPath = join(evidence, "session.json");
const mode = process.argv[2] ?? "baseline";
let state;

async function hashes(directory, prefix = "") {
  const result = {};
  for (const name of (await readdir(join(directory, prefix))).sort()) {
    const path = join(prefix, name);
    const stat = await lstat(join(directory, path));
    assert.ok(!stat.isSymbolicLink(), `regular-file freeze: ${path}`);
    if (stat.isDirectory()) Object.assign(result, await hashes(directory, path));
    else result[path] = hash(await readFile(join(directory, path)));
  }
  return result;
}

async function verifyInputs(overlays = new Set()) {
  for (const [path, expected] of Object.entries(state.inputs)) {
    if (!overlays.has(path)) assert.equal(hash(await readFile(join(state.scratch, path))), expected, path);
  }
}

async function run(name, args) {
  const stdoutPath = join(evidence, `${name}.stdout`);
  const stderrPath = join(evidence, `${name}.stderr`);
  const result = await supervise(process.execPath, args, {
    cwd: state.scratch, env: { ...process.env, LC_ALL: "C", LANG: "C", TMPDIR: join(state.scratch, "tmp"), SAFEJS_LOCAL_ROOT: "" },
    stdout: stdoutPath, stderr: stderrPath, timeoutMs: 120000, maxOutputBytes: 8 * 1024 * 1024,
  });
  const stdout = await readFile(stdoutPath, "utf8");
  result.counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  result.failures = [...stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
  result.stdoutSha256 = hash(stdout);
  result.stderrSha256 = hash(await readFile(stderrPath));
  await save(join(evidence, `${name}.json`), result);
  assert.equal(result.timedOut, false);
  assert.equal(result.outputExceeded, false);
  assert.deepEqual(result.survivors, []);
  assert.equal(result.observerError, undefined);
  console.log(name, JSON.stringify({ status: result.status, counts: result.counts, failures: result.failures }));
  return result;
}

const testArgs = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap"];

if (mode === "baseline") {
  await mkdir(evidence, { recursive: true });
  const commit = git("rev-parse", revision).toString().trim();
  const paths = git("ls-tree", "-r", "--name-only", commit).toString().trim().split("\n").filter(path =>
    path.startsWith("src/") || /^tests\/.*\.ts$/.test(path) || ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].includes(path));
  const scratch = await mkdtemp("/tmp/safe-bash-authority-reconciliation-");
  const archive = git("archive", "--format=tar", commit, "--", ...paths);
  execFileSync("/usr/bin/tar", ["-xf", "-", "-C", scratch], { input: archive });
  state = { commit, historicalCommit: git("rev-parse", "e36dab2").toString().trim(), scratch, startedAt: new Date().toISOString(), node: process.version,
    platform: process.platform, arch: process.arch, archiveSha256: hash(archive), movingHead: git("rev-parse", "HEAD").toString().trim(),
    movingStatus: git("status", "--porcelain=v1").toString(), inputs: await hashes(scratch), fixtures };
  assert.equal(hash(await readFile(join(root, "package-lock.json"))), state.inputs["package-lock.json"]);
  await cp(join(root, "node_modules"), join(scratch, "node_modules"), { recursive: true, dereference: true });
  state.dependencyHashes = await hashes(join(scratch, "node_modules"));
  await mkdir(join(scratch, "tmp"));
  for (const path of fixtures) {
    const original = git("show", `${state.historicalCommit}:${path}`);
    assert.equal(hash(original), state.inputs[path], `original fixture changed: ${path}`);
    await save(join(output, "original", `${path.split("/").at(-1)}.txt`), original);
  }
  const old = JSON.parse(await readFile(join(owned, "../evidence/classification.json"), "utf8"));
  const rows = old.failures.filter(row => fixtures.includes(row.path));
  assert.equal(rows.length, 25);
  await save(join(output, "original", "full-gate-25.json"), { revision: state.historicalCommit, rows });
  await save(sessionPath, state);
  await verifyInputs();
  const result = await run("baseline-original", [...testArgs, ...fixtures]);
  assert.equal(result.counts.fail, 25);
  assert.deepEqual([...result.failures].sort(), rows.map(row => row.name).sort());
  await verifyInputs();
} else {
  state = JSON.parse(await readFile(sessionPath, "utf8"));
  if (mode === "candidate") {
    const label = process.argv[3] ?? "candidate";
    const overlays = {};
    for (const path of fixtures) {
      const data = await readFile(join(root, path));
      await writeFile(join(state.scratch, path), data);
      overlays[path] = hash(data);
      await save(join(evidence, `${label}-inputs`, `${path.split("/").at(-1)}.txt`), data);
    }
    await save(join(evidence, `${label}-inputs.json`), overlays);
    await verifyInputs(new Set(fixtures));
    await run(label, [...testArgs, ...fixtures]);
    await run(`${label}-guards53`, [...testArgs, ...guards]);
    await run(`${label}-adjacent`, [...testArgs, ...adjacent]);
    await save(join(state.scratch, `${label}-types.json`), { extends: "./tsconfig.json", compilerOptions: { noEmit: true }, files: [...fixtures, ...guards, ...adjacent], include: [], exclude: [] });
    await run(`${label}-scoped-types`, ["node_modules/typescript/bin/tsc", "--noEmit", "-p", `${label}-types.json`]);
    await verifyInputs(new Set(fixtures));
  } else if (mode === "mutants") {
    const candidates = JSON.parse(await readFile(join(evidence, "final-inputs.json"), "utf8"));
    for (const [path, expected] of Object.entries(candidates)) assert.equal(hash(await readFile(join(state.scratch, path))), expected);
    const mutants = [
      { name: "memory-method-identity", path: "src/fs/memory/index.ts",
        before: "intact: () => this.root === root,",
        after: "intact: () => this.root === root && this.writeFile === memoryImplementation.writeFile?.value && this.writeStream === memoryImplementation.writeStream?.value,",
        catches: "memory subclass-before buffered: faithful writer" },
      { name: "s3-method-identity", path: "src/fs/s3/filesystem.ts",
        before: "&& this.bucket === bucket && this.prefix === registeredPrefix, s3Comparison, options.compareEntry);",
        after: "&& this.bucket === bucket && this.prefix === registeredPrefix && this.writeFile === s3OriginalWrite, s3Comparison, options.compareEntry);",
        append: "\nconst s3OriginalWrite = S3FileSystem.prototype.writeFile;\n",
        catches: "s3 subclass-before buffered: faithful writer" },
      { name: "unknown-overwrite", path: "src/fs/mount/index.ts",
        before: 'if (target.stat && identity === "unknown") fail("ENOTSUP");', after: "",
        catches: "honest path remapper omits changed authority" },
      { name: "alias-overwrite", path: "src/fs/mount/index.ts",
        before: 'if (identity === "same") fail("EINVAL");', after: "", count: 2,
        catches: "faithful writer preserves qualified copy and alias rejection" },
      { name: "authority-error-swallowed", path: "src/fs/mount/comparison.ts",
        before: "} catch (error) {\n        options.signal?.throwIfAborted();\n        throw error;\n      }",
        after: '} catch (error) {\n        options.signal?.throwIfAborted();\n        answer = "unknown";\n      }',
        catches: "post-construction explicit comparison error" },
      { name: "fabricated-sdk-authority", path: "src/fs/s3/authority.ts",
        before: "if (proof?.query === query) acceptedHeads.set(output, proof.entry);",
        after: "if (proof?.query === query) acceptedHeads.set(output, proof.entry);\n    else acceptedHeads.set(output, { storage: output, key: input.Key });",
        catches: "S3 honest local-data remapper" },
      { name: "retain-unrelated-s3-head", path: fixtures[1],
        before: "headObject: async (input, options) => ({ ...await forwarding.headObject(input, options) }),",
        after: "headObject: async (input, options) => forwarding.headObject(input, options),",
        catches: "S3 honest local-data remapper" },
      { name: "retain-unrelated-dav-response", path: fixtures[1],
        before: "if (init.method !== \"PROPFIND\" || response.status !== 207) return response;",
        after: "if (response) return response;",
        catches: "WebDAV honest local-data fetch" },
      { name: "duplicate-helper-property", path: fixtures[2],
        before: 'const xml = suppliedXml.replace(/<z:resource-id>.*?<\\/z:resource-id>/gs, "");',
        after: "const xml = suppliedXml;",
        catches: "WebDAV resource-id protocol fixture" },
      { name: "accept-duplicate-protocol-property", path: fixtures[2],
        before: 'if (identifiers.length !== 1 || !/^urn:uuid:[0-9a-f-]{36}$/.test(identifiers[0]!)) return undefined;',
        after: 'if (identifiers.length === 0 || !/^urn:uuid:[0-9a-f-]{36}$/.test(identifiers[0]!)) return undefined;',
        catches: "WebDAV resource-id protocol fixture" },
    ];
    const patch = (path, before, after) => {
      const body = `*** Begin Patch\n*** Update File: ${join(state.scratch, path)}\n@@\n${before.trimEnd().split("\n").map(line => `-${line}`).join("\n")}\n${after.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
      execFileSync("apply_patch", [body], { cwd: state.scratch, maxBuffer: 1024 * 1024 });
    };
    for (const mutant of mutants) {
      await verifyInputs(new Set(fixtures));
      const original = await readFile(join(state.scratch, mutant.path), "utf8");
      assert.equal(original.split(mutant.before).length - 1, mutant.count ?? 1, mutant.name);
      const changed = original.replaceAll(mutant.before, mutant.after) + (mutant.append ?? "");
      await save(join(evidence, `mutant-${mutant.name}-input.json`), { ...mutant, beforeSha256: hash(original), afterSha256: hash(changed), temporarySnapshotOnly: true });
      patch(mutant.path, original, changed);
      try {
        const result = await run(`mutant-${mutant.name}`, [...testArgs, ...fixtures]);
        assert.equal(result.status, 1);
        assert.ok(result.counts.fail > 0);
        assert.equal(result.counts.tests, 85);
        assert.equal(result.counts.cancelled + result.counts.skipped + result.counts.todo, 0);
        assert.ok(result.failures.some(name => name.includes(mutant.catches)), `missing expected guard: ${mutant.name}`);
      } finally { patch(mutant.path, changed, original); }
      assert.equal(hash(await readFile(join(state.scratch, mutant.path))), hash(original));
    }
    await verifyInputs(new Set(fixtures));
    await run("post-mutants", [...testArgs, ...fixtures]);
  } else if (mode === "cleanup") {
    await verifyInputs(new Set(fixtures));
    assert.deepEqual(await hashes(join(state.scratch, "node_modules")), state.dependencyHashes);
    assert.ok(state.scratch.startsWith("/tmp/safe-bash-authority-reconciliation-"));
    await rm(state.scratch, { recursive: true });
    await save(join(evidence, "cleanup.json"), { removed: state.scratch, inputsUnchangedExceptOwnedFixtures: true, dependenciesUnchanged: true, finishedAt: new Date().toISOString() });
  } else throw new Error(`unknown mode ${mode}`);
}
