import assert from "node:assert/strict";
import native from "node:child_process";
import { createHash } from "node:crypto";
import type * as fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { oracle, suiteRoot } from "./helpers.js";

for (const protection of ["startup files", "private home"] as const) {
  test(`native umask launch isolates ${protection} without changing command results`, context => {
    const cwd = join(suiteRoot, ".native-in-memory-launch");
    const executablePath = "/owned/bin/mktemp";
    const bytes = Buffer.from("synthetic mktemp identity; never executed");
    const fileSystem = createFsFromVolume(Volume.fromJSON({ [executablePath]: bytes })) as unknown as typeof fs;
    fileSystem.chmodSync(executablePath, 0o755);
    const pin = { tool: "mktemp", version: "mktemp (GNU coreutils) 9.7", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    const host = { platform: "darwin", arch: "arm64", distribution: "macos", version: "26.5.2", release: "25.5.0" };
    let admissions = 0;
    const identityOptions = {
      ...host, path: executablePath, fileSystem,
      profiles: [{ id: "in-memory-launch-fixture", qualification: "QUALIFIED", host, executables: [pin] }],
      run: (executable: string, args: readonly string[]) => {
        assert.equal(executable, executablePath);
        assert.deepEqual(args, ["--version"]);
        admissions++;
        return { status: 0, signal: null, stdout: pin.version + "\n", stderr: "" };
      },
    };
    const stdout = Buffer.from([0, 255, 10]);
    const stderr = Buffer.from("exact native diagnostic\n");
    let launches = 0;
    const mock = context.mock.method(native, "spawnSync", (...invocation: Parameters<typeof native.spawnSync>) => {
      const [executable, args, options] = invocation;
      assert.equal(executable, "/bin/bash");
      launches++;
      assert(args);
      assert(options);
      assert.equal(args[6], executablePath);
      assert.equal(options.cwd, cwd);
      assert.equal(options.timeout, 3000);
      if (protection === "startup files") {
        assert.deepEqual(args.slice(0, 3), ["--noprofile", "--norc", "-c"]);
        assert.deepEqual(args.slice(3, 6), ['umask "$1"; shift; exec "$@"', "metadata-oracle", "27"]);
        assert.deepEqual(args.slice(-2), ["--", "missing"]);
      } else {
        assert.equal(options.env?.HOME, cwd);
        assert.equal(options.env?.TMPDIR, cwd);
        assert.equal(options.env?.LC_ALL, "C");
        assert.equal(options.env?.CUSTOM, "fixture");
        assert.equal(options.env?.BASH_ENV, undefined);
        assert.equal(options.env?.ENV, undefined);
      }
      return { pid: 0, output: [null, stdout, stderr], stdout, stderr, status: 17, signal: null };
    });
    syncBuiltinESMExports();
    try {
      const result = oracle("mktemp", ["--", "missing"], cwd, 0o027, { CUSTOM: "fixture" }, identityOptions);
      assert.equal(admissions, 1);
      assert.equal(launches, 1);
      assert.equal(result.exitCode, 17);
      assert.deepEqual(result.stdout, stdout);
      assert.equal(result.stderr, stderr.toString());
    } finally {
      mock.mock.restore();
      syncBuiltinESMExports();
    }
  });
}
