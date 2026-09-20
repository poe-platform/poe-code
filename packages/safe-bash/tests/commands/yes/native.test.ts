import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { createCommandArguments } from "../../../src/contracts/command.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { createYesCommand } from "../../../src/commands/yes/index.js";
import { capture, gnuHelp, gnuVersion, prefix, virtualVersion } from "./fixtures.js";

async function oracle(executable: string, args: readonly string[], limit = 4096, extraEnv: Record<string, string> = {}, closeOutput = false) {
  // Node stdout pipes can be sockets. A bounded head consumer creates the
  // kernel pipe whose SIGPIPE behavior this probe observes through pipefail.
  const command = closeOutput ? "/bin/bash" : executable;
  const commandArgs = closeOutput
    ? ["--noprofile", "--norc", "-c", 'set -o pipefail; "$1" "${@:3}" | /usr/bin/head -c "$2"; exit $?', "oracle", executable, String(limit), ...args]
    : args;
  const child = spawn(command, commandArgs, { argv0: command === "/bin/bash" ? "bash" : "yes", stdio: ["ignore", "pipe", "pipe"], env: { LC_ALL: "C", LANG: "C", ...extraEnv } });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  let outputBytes = 0;
  let errorBytes = 0;
  let capped = false;
  let timedOut = false;
  let failure: Error | undefined;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 2000);
  child.on("error", error => { failure = error; });
  child.stdout.on("data", (chunk: Buffer) => {
    const count = Math.min(chunk.length, limit - outputBytes);
    if (count) stdout.push(new Uint8Array(chunk.subarray(0, count)));
    outputBytes += count;
    if (!capped && outputBytes === limit) {
      capped = true;
      if (!closeOutput) child.kill("SIGKILL");
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const count = Math.min(chunk.length, 4096 - errorBytes);
    if (count) stderr.push(new Uint8Array(chunk.subarray(0, count)));
    errorBytes += count;
    if (errorBytes === 4096) { failure = new Error("native stderr limit"); child.kill("SIGKILL"); }
  });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  if (failure) throw failure;
  assert.equal(timedOut, false, "native oracle timed out (killed and drained)");
  return { ...result, capped, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

test("bounded system oracle explicitly distinguishes Darwin BSD from GNU", async context => {
  const binary = "/usr/bin/yes";
  const version = await oracle(binary, ["--version"], 1024);
  const gnu = version.stdout.toString().startsWith("yes (GNU coreutils) ");
  if (!gnu) {
    assert.equal(process.platform, "darwin", "unknown native yes profile");
    assert.equal(version.capped, true);
    assert.equal(version.stdout.subarray(0, 10).toString(), "--version\n");
  }
  context.diagnostic(`${binary}: ${gnu ? version.stdout.toString().split("\n")[0] : "Darwin BSD yes; NOT a GNU option oracle"}`);
  for (const args of [[], [""], ["é😀"], ["a\nb\\n"], ["-"]]) {
    const native = await oracle(binary, args, 97);
    assert.equal(native.capped, true);
    const virtual = await prefix(createYesCommand({ chunkBytes: 7 }), args, 97);
    assert.deepEqual(Buffer.from(virtual.bytes), native.stdout);
  }
  const delimiter = await oracle(binary, ["--"], 3);
  assert.equal(delimiter.stdout.toString(), gnu ? "y\ny" : "--\n");
  const emptyOperands = await oracle(binary, ["", ""], 4);
  assert.equal(emptyOperands.stdout.toString(), gnu ? " \n \n" : "\n\n\n\n");
  const leadingEmpty = await oracle(binary, ["", "word"], 6);
  assert.equal(leadingEmpty.stdout.toString(), gnu ? " word\n" : "\n\n\n\n\n\n");
  const multiple = await oracle(binary, ["one", "two"], 8);
  assert.equal(multiple.stdout.toString(), gnu ? "one two\n" : "one\none\n");
  const shortConsumer = await oracle(binary, [], 2, {}, true);
  assert.equal(shortConsumer.stdout.toString(), "y\n");
  assert.equal(shortConsumer.signal, null);
  assert.equal(shortConsumer.code, 141);
  assert.equal(shortConsumer.stderr.length, 0);
});

test("pinned GNU 9.7 differential: permutations, abbreviations, errors, raw argv, and buffers", async context => {
  const binary = process.env.SAFE_BASH_YES_GNU_ORACLE;
  if (!binary) { context.skip("Set SAFE_BASH_YES_GNU_ORACLE to root's pinned GNU coreutils 9.7 src/yes"); return; }
  const version = await oracle(binary, ["--version"]);
  assert.equal(version.code, 0);
  assert.equal(version.capped, false);
  assert.equal(version.stdout.toString(), gnuVersion);
  const nativeHelp = await oracle(binary, ["--help"]);
  const virtualHelp = capture(["--help"]);
  assert.equal(nativeHelp.code, 0);
  assert.equal(nativeHelp.capped, false);
  assert.equal(nativeHelp.stdout.toString(), gnuHelp);
  assert.equal(nativeHelp.stderr.length, 0);
  assert.deepEqual(await createYesCommand().execute(virtualHelp.context), { exitCode: 0 });
  assert.deepEqual(Buffer.concat(virtualHelp.stdout), nativeHelp.stdout);
  const virtualIdentity = capture(["--version"]);
  assert.deepEqual(await createYesCommand().execute(virtualIdentity.context), { exitCode: 0 });
  assert.equal(Buffer.concat(virtualIdentity.stdout).toString(), virtualVersion);
  assert.equal(virtualIdentity.stderr.length, 0);
  context.diagnostic(`${binary}: GNU coreutils 9.7, ${process.platform}, LC_ALL=C (not GNU/Linux qualification on Darwin)`);
  const cases = [
    [], [""], ["", ""], ["one", "two"], ["-"], ["--"], ["--", "--"], ["--", "--help", "-n"],
    ["before", "--", "--version", "after"], ["text", "--help"], ["--h"], ["--hel"],
    ["--version"], ["--v"], ["--vers"], ["--help", "--bad"], ["--version", "--help"],
    ["-n"], ["-h"], ["-v"], ["-help"], ["--bad"], ["text", "--bad"], ["--bad", "--help"],
    ["--help="], ["--v=x"], ["--=x"], ["---"], ["word", "--", "tail"],
    ["x".repeat(8192)], Array.from({ length: 100 }, (_, index) => String(index)),
  ];
  for (const env of [{}, { POSIXLY_CORRECT: "" }]) {
    for (const [index, args] of cases.entries()) await context.test(`argv case ${index}, POSIXLY_CORRECT ${Object.hasOwn(env, "POSIXLY_CORRECT") ? "present" : "absent"}`, async () => {
      const native = await oracle(binary, args, 1024, env);
      if (native.capped) {
        const actual = Buffer.from((await prefix(createYesCommand({ chunkBytes: 4096 }), args, 1024, { env })).bytes);
        assert.equal(actual.equals(native.stdout), true, JSON.stringify({ args, env, virtualPrefix: actual.subarray(0, 32).toString("hex"), nativePrefix: native.stdout.subarray(0, 32).toString("hex") }));
      } else {
        const fixture = capture(args, { env });
        assert.equal((await createYesCommand().execute(fixture.context)).exitCode, native.code);
        assert.deepEqual(Buffer.concat(fixture.stderr), native.stderr);
        if (native.code === 0) {
          if (native.stdout.toString() === gnuVersion) {
            assert.equal(Buffer.concat(fixture.stdout).toString(), virtualVersion);
          } else {
            assert.equal(native.stdout.toString(), gnuHelp);
            assert.deepEqual(Buffer.concat(fixture.stdout), native.stdout);
          }
        } else assert.equal(fixture.stdout.length, 0);
      }
    });
  }
  const nativeRaw = await oracle("/bin/bash", ["-c", 'exec "$1" -- $\'\\xff\' $\'\\xfe\' ""', "oracle", binary], 97);
  const argumentValues = createCommandArguments(["--", shellValueFromBytes(Uint8Array.of(255)), shellValueFromBytes(Uint8Array.of(254)), ""]);
  const virtualRaw = await prefix(createYesCommand({ chunkBytes: 7 }), argumentValues.args, 97, { argumentValues });
  assert.deepEqual(Buffer.from(virtualRaw.bytes), nativeRaw.stdout);
  const shortConsumer = await oracle(binary, [], 2, {}, true);
  assert.equal(shortConsumer.stdout.toString(), "y\n");
  assert.equal(shortConsumer.signal, null);
  assert.equal(shortConsumer.code, 141);
  assert.equal(shortConsumer.stderr.length, 0);
});
