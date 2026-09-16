import assert from "node:assert/strict";
import test from "node:test";
import { run, seed } from "./helpers.js";

for (const [args, message, usage] of [
  [[], "missing file operand", true], [["source"], "missing destination file operand after 'source'", true],
  [["-ds", "dir"], "the strip option may not be used when installing a directory", false],
  [["-d", "-tdir", "other"], "target directory not allowed when installing a directory", false],
  [["-ta", "-tb", "source"], "multiple target directories specified", false],
  [["-T", "a", "b", "c"], "extra operand 'c'", true],
  [["-Cp", "source", "target"], "options --compare (-C) and --preserve-timestamps are mutually exclusive", true],
  [["-Cs", "source", "target"], "options --compare (-C) and --strip are mutually exclusive", true],
  [["-mBAD", "source", "target"], "invalid mode 'BAD'", false],
  [["--mod"], "option '--mode' requires an argument", true],
  [["--directory=1"], "option '--directory' doesn't allow an argument", true],
  [["-help"], "invalid option -- 'h'", true],
  [["--unknown"], "unrecognized option '--unknown'", true],
] as const) {
  test(`GNU option diagnostics ${args.join(" ")}`, async () => {
    const result = await run(args);
    assert.deepEqual(result, { exitCode: 1, stdout: "", stderr: `install: ${message}\n${usage ? "Try 'install --help' for more information.\n" : ""}` });
  });
}

test("help/version use long abbreviations; c is ignored; options permute", async () => {
  assert.match((await run(["--he", "-x"])).stdout, /--strip-program/u);
  assert.match((await run(["--vers"])).stdout, /9\.7/u);
  assert.equal((await run(["--ver"])).stderr, "install: option '--ver' is ambiguous; possibilities: '--verbose' '--version'\nTry 'install --help' for more information.\n");
  const fs = await seed();
  assert.equal((await run(["source", "-c", "--mod=600", "target"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/target")).mode & 0o7777, 0o600);
});

test("disabled SELinux profile warns only when required and ignores flags", async () => {
  const fs = await seed();
  assert.equal((await run(["-Z", "source", "target"], fs)).stderr, "");
  assert.equal((await run(["--context=label", "source", "target"], fs)).stderr, "install: warning: ignoring --context; it requires an SELinux-enabled kernel\n");
  assert.equal((await run(["--preserve-context", "--help"], fs)).stderr, "install: WARNING: ignoring --preserve-context; this kernel is not SELinux-enabled\n");
});

test("strip-program without -s warns and does not invoke a hook", async () => {
  const fs = await seed();
  const result = await run(["--strip-program=not-an-executable", "source", "target"], fs, { strip() { throw new Error("must not strip"); } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "install: WARNING: ignoring --strip-program option as -s option was not specified\n");
});

test("POSIXLY_CORRECT stops permutation even when its value is empty", async () => {
  const fs = await seed();
  const result = await run(["source", "target", "-m600"], fs, {}, { env: { POSIXLY_CORRECT: "" } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "install: target '-m600': No such file or directory\n");
  await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
});

test("required short values consume their cluster and repeated modes use the last", async () => {
  const fs = await seed();
  assert.equal((await run(["-vm600", "-m", "u=rw,g=r", "source", "target"], fs)).stdout, "'source' -> 'target'\n");
  assert.equal((await fs.stat("/target")).mode & 0o7777, 0o640);
});

test("backup optional values require equals and help preserves earlier parse errors", async () => {
  assert.equal((await run(["--backup", "numbered"])).stderr, "install: missing destination file operand after 'numbered'\nTry 'install --help' for more information.\n");
  assert.equal((await run(["--bad", "--help"])).exitCode, 1);
  assert.equal((await run(["--help", "--bad"])).exitCode, 0);
});
