import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as native from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { captureNativeReport, createNativeCapture, createNativeScratch } from "./native-capture.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const suite = "tests/commands/split";
const canonical = ["native.test.ts", "native-errors.test.ts", "edge.test.ts", "stress.test.ts", "dangling-native.test.ts"];
const sources = [...canonical, "native-capture.ts", "cases.ts", "helpers.ts"];
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function environment(values: Record<string, string | undefined>, action: () => Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  const set = (entries: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  };
  set(values);
  try { await action(); } finally { set(previous); }
}

async function snapshot(directory: string) {
  const hashes: Record<string, string> = {};
  const visit = async (path: string): Promise<void> => {
    const stat = await native.lstat(join(directory, path));
    if (stat.isDirectory()) {
      for (const name of (await native.readdir(join(directory, path))).sort()) await visit(join(path, name));
    } else if (stat.isFile()) hashes[path] = sha256(await native.readFile(join(directory, path)));
    else throw new Error(`Unexpected evidence entry: ${path}`);
  };
  for (const name of [...sources, "evidence"]) await visit(join(suite, name));
  return { hashes, names: (await native.readdir(join(directory, suite))).sort() };
}

test("native capture is off by default, including serialization and filesystem effects", async () => {
  const before = await snapshot(root);
  await environment({ VIRTUAL_BASH_SPLIT_CAPTURE: undefined }, async () => {
    const result = await captureNativeReport({ diagnostic() { assert.fail("unexpected capture diagnostic"); } }, "gnu-errors", {
      toJSON() { assert.fail("disabled capture must not serialize"); },
    });
    assert.equal(result, undefined);
  });
  assert.deepEqual(await snapshot(root), before);
});

test("explicit native capture returns distinct retained paths and exact report bytes", async () => {
  const diagnostics: string[] = [];
  const paths: string[] = [];
  const report = { expected: { status: 1, bytes: "00ff" }, observed: { status: 2, bytes: "fe00" }, semanticMatch: false };
  try {
    await environment({ VIRTUAL_BASH_SPLIT_CAPTURE: "1" }, async () => {
      for (let index = 0; index < 2; index++) {
        const path = await captureNativeReport({ diagnostic(message) { diagnostics.push(message); } }, "gnu-errors", report, true);
        assert.ok(path);
        paths.push(path);
        assert.equal(await native.readFile(path, "utf8"), JSON.stringify(report, null, 2) + "\n");
        assert.equal((await native.stat(path)).mode & 0o777, 0o600);
        assert.equal((await native.stat(dirname(path))).mode & 0o777, 0o700);
      }
    });
    assert.notEqual(paths[0], paths[1]);
    assert.deepEqual(diagnostics, paths.map(path => `split native capture: ${path}`));
  } finally { for (const path of paths) await native.rm(dirname(path), { recursive: true }); }
});

test("native capture rejects path-valued switches and invalid report names", async () => {
  const before = await snapshot(root);
  for (const setting of [root, join(root, suite, "evidence/gnu-errors-latest.json"), "0", ""]) {
    await environment({ VIRTUAL_BASH_SPLIT_CAPTURE: setting }, async () => {
      await assert.rejects(captureNativeReport({ diagnostic() {} }, "gnu-errors", {}), /accepts only 1, not a destination/);
    });
  }
  await assert.rejects(createNativeCapture("../escape" as "gnu-errors"), /Unknown split native report name/);
  assert.deepEqual(await snapshot(root), before);
});

test("remaining native reports publish concurrently without sharing destinations", async () => {
  const captures = await Promise.all(["edge", "stress", "dangling-native"].flatMap(name =>
    Array.from({ length: 2 }, () => createNativeCapture(name as "edge" | "stress" | "dangling-native"))));
  try {
    assert.equal(new Set(captures.map(capture => capture.directory)).size, 6);
    await Promise.all(captures.map(async (capture, index) => {
      await capture.write({ index });
      assert.deepEqual(JSON.parse(await native.readFile(capture.path, "utf8")), { index });
      await assert.rejects(capture.write({ replacement: true }), { code: "EEXIST" });
    }));
  } finally { for (const capture of captures) await native.rm(capture.directory, { recursive: true }); }
});

test("native scratch and capture reject repository temp roots, including symlink aliases", async () => {
  const directory = await native.mkdtemp(join(await native.realpath(tmpdir()), "virtual-bash-split-guard-"));
  const before = await snapshot(root);
  try {
    const alias = join(directory, "repository");
    await native.symlink(root, alias, "dir");
    for (const temporary of [root, join(root, suite), alias]) {
      await environment({ TMPDIR: temporary, TMP: temporary, TEMP: temporary }, async () => {
        await assert.rejects(createNativeCapture("gnu-errors"), /outside the repository/);
        await assert.rejects(createNativeScratch({ after() { assert.fail("scratch acquired"); }, diagnostic() {} }), /outside the repository/);
      });
    }
    assert.deepEqual(await snapshot(root), before);
  } finally { await native.rm(directory, { recursive: true }); }
});

test("native capture refuses overwrites, output symlinks, and replaced destination directories", async () => {
  for (const guard of ["overwrite", "symlink", "dangling-symlink", "directory-symlink", "directory-replaced"]) {
    const capture = await createNativeCapture("gnu-errors");
    const target = await native.mkdtemp(join(await native.realpath(tmpdir()), "virtual-bash-split-target-"));
    const moved = `${capture.directory}-original`;
    try {
      const sentinel = join(target, "sentinel.json");
      await native.writeFile(sentinel, "ORIGINAL", { flag: "wx" });
      if (guard === "overwrite") await capture.write({ original: true });
      else if (guard === "symlink") await native.symlink(sentinel, capture.path);
      else if (guard === "dangling-symlink") await native.symlink(join(target, "absent.json"), capture.path);
      else {
        await native.rename(capture.directory, moved);
        if (guard === "directory-symlink") await native.symlink(target, capture.directory, "dir");
        else await native.mkdir(capture.directory);
      }
      await assert.rejects(capture.write({ replacement: true }), guard.startsWith("directory-") ? /identity changed or is a symlink/ : { code: "EEXIST" });
      assert.equal(await native.readFile(sentinel, "utf8"), "ORIGINAL");
      assert.deepEqual(await native.readdir(target), ["sentinel.json"]);
      if (guard === "overwrite") assert.deepEqual(JSON.parse(await native.readFile(capture.path, "utf8")), { original: true });
    } finally {
      for (const directory of [capture.directory, moved, target]) await native.rm(directory, { recursive: true, force: true });
    }
  }
});

for (const failed of [false, true]) for (const capture of [false, true]) {
  test(`actual native harness ${failed ? "injected mismatch" : "success"}, capture ${capture ? "on" : "off"}, preserves repository evidence`, { timeout: 120_000 }, async context => {
    for (const [executable, hash] of [
      [join(root, "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/split"), "cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958"],
      ["/usr/bin/split", "7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91"],
    ] as const) {
      let binary: Uint8Array;
      try { binary = await native.readFile(executable); }
      catch { context.skip(`oracle unavailable: ${executable}`); return; }
      assert.equal(sha256(binary), hash, "oracle changed: pin must be reviewed");
    }
    const directory = await native.mkdtemp(join(await native.realpath(tmpdir()), "virtual-bash-split-regression-"));
    const temporary = join(directory, "temporary");
    const sandbox = join(directory, "sandbox");
    const before = await snapshot(root);
    try {
      await native.mkdir(temporary);
      let working = root;
      if (failed) {
        working = sandbox;
        await native.mkdir(join(sandbox, suite), { recursive: true });
        for (const name of ["src", "node_modules"]) await native.symlink(join(root, name), join(sandbox, name), "dir");
        await native.copyFile(join(root, "package.json"), join(sandbox, "package.json"));
        await native.symlink(join(root, "tests/commands/metadata-stress"), join(sandbox, "tests/commands/metadata-stress"), "dir");
        for (const name of sources) await native.copyFile(join(root, suite, name), join(sandbox, suite, name));
        await native.cp(join(root, suite, "evidence"), join(sandbox, suite, "evidence"), { recursive: true });
        const mutations = [
          ["native.test.ts", "exitCode: actual.exitCode, stdout: actual.stdout", "exitCode: actual.exitCode + Number(specimen.id === \"default-empty\"), stdout: actual.stdout"],
          ["native-errors.test.ts", "const actual = await run(specimen.args, specimen.input, {}, { fs });", "const actual = await run(specimen.args, specimen.input, {}, { fs });\n    if (specimen.id === \"zero-lines\") actual.exitCode += 1;"],
          ["edge.test.ts", "const observed = await run(args);", "const observed = await run(args);\n    if (size === \"1g\") observed.exitCode += 1;"],
          ["stress.test.ts", "const actual = await run(args, chunks(input, chunkSize, true), { limits: { maxChunkBytes: 4096 } });", "const actual = await run(args, chunks(input, chunkSize, true), { limits: { maxChunkBytes: 4096 } });\n        if (inputName === \"64KiB-record-edges\" && args[0] === \"-C4096\" && chunkSize === 65537) actual.exitCode += 1;"],
          ["dangling-native.test.ts", "const result = await run(args, \"\", {}, { fs });", "const result = await run(args, \"\", {}, { fs });\n        if (fixture.id === \"relative\" && backend === \"memory\") result.exitCode += 1;"],
        ] as const;
        for (const [name, original, replacement] of mutations) {
          const path = join(sandbox, suite, name);
          const source = await native.readFile(path, "utf8");
          assert.equal(source.split(original).length, 2, "fault injection site must be unique");
          await native.writeFile(path, source.replace(original, replacement));
        }
      }
      const baseline = await snapshot(working);
      const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, TSX_DISABLE_CACHE: "1" };
      delete env.NODE_TEST_CONTEXT;
      delete env.VIRTUAL_BASH_SPLIT_CAPTURE;
      if (capture) env.VIRTUAL_BASH_SPLIT_CAPTURE = "1";
      const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=3", "--test-reporter=tap", ...canonical.map(name => join(suite, name))], {
        cwd: working, env, encoding: "utf8", timeout: 100_000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024,
      });
      assert.equal(child.error, undefined);
      assert.equal(child.signal, null);
      assert.equal(child.status, failed ? 1 : 0, child.stdout + child.stderr);
      assert.match(child.stdout, failed ? /# pass 1\n# fail 6\n/ : /# pass 7\n# fail 0\n/);
      assert.match(child.stdout, /# skipped 0\n/);
      const paths = [...child.stdout.matchAll(/^# split native capture: (.+)$/gm)].map(match => match[1]!);
      assert.equal(paths.length, capture ? 7 : 0);
      assert.equal(new Set(paths).size, paths.length);
      for (const path of paths) assert.equal(dirname(dirname(path)), temporary);
      const scratches = [...child.stdout.matchAll(/^# split native scratch retained: (.+)$/gm)].map(match => match[1]!);
      assert.equal(scratches.length, failed ? 4 : 0);
      for (const path of scratches) { assert.equal(dirname(path), temporary); assert.ok((await native.stat(path)).isDirectory()); }
      if (failed) {
        const errorsPath = paths.find(path => path.endsWith("/gnu-errors.json"));
        const failureLine = /^# split native failure gnu-errors \(base64\): (.+)$/m.exec(child.stdout);
        const report = errorsPath ? JSON.parse(await native.readFile(errorsPath, "utf8")) : JSON.parse(Buffer.from(failureLine![1]!, "base64").toString("utf8"));
        assert.equal(report.report.length, 9);
        assert.equal(report.report[0].id, "zero-lines");
        assert.equal(report.report[0].semanticMatch, false);
        assert.equal(report.report[0].expected.status, 1);
        assert.equal(report.report[0].observed.status, 2);
        assert.equal(report.report[0].expected.stderr, "split: invalid number of lines: '0'\n");
        assert.equal(report.report[0].observed.stderr, report.report[0].expected.stderr);
        context.diagnostic(`Injected harness-only mismatch retained before cleanup: ${JSON.stringify(report.report[0])}`);
        for (const [name, rows] of [["edge", 18], ["stress", 8], ["dangling-native", 11]] as const) {
          const reportPath = paths.find(path => path.endsWith(`/${name}.json`));
          const diagnostic = new RegExp(`^# split native failure ${name} \\(base64\\): (.+)$`, "m").exec(child.stdout);
          assert.ok(reportPath || diagnostic, `${name} failure evidence must survive`);
          const failure = JSON.parse(reportPath ? await native.readFile(reportPath, "utf8") : Buffer.from(diagnostic![1]!, "base64").toString("utf8"));
          assert.equal((failure.evidence ?? failure.report).length, rows);
          if (name === "edge") {
            assert.equal(failure.failed, true);
            assert.equal(failure.evidence[0].semanticMatch, false);
            assert.equal(failure.evidence[0].observed.status, failure.evidence[0].expected.status + 1);
          } else if (name === "stress") {
            assert.equal(failure.failed, true);
            assert.equal(failure.report[0].variants[0].match, false);
            assert.equal(failure.report[0].variants[0].observed.status, failure.report[0].expected.status + 1);
          } else {
            assert.equal(failure.failures.length, 1);
            assert.equal(failure.report[0].observed[0].match, false);
            assert.equal(failure.report[0].observed[0].actual.status, failure.report[0].profiles["GNU9.7-Darwin"].status + 1);
          }
        }
      }
      assert.deepEqual(await snapshot(working), baseline);
      assert.deepEqual(await snapshot(root), before);
      assert.equal((await native.readdir(temporary)).length, paths.length + scratches.length);
    } finally { await native.rm(directory, { recursive: true, force: true }); }
  });
}
