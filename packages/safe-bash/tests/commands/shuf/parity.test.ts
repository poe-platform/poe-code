import assert from "node:assert/strict";
import { test } from "node:test";
import { entropy, native, nativeOptions, randomPath, run } from "./helpers.js";

const cases: readonly (readonly string[])[] = [
  ["-e", "a", "b", "c", "d"], ["-en2", "a", "b", "c"],
  ["-e", "a", "-n", "2", "b", "c"], ["-e", "--", "-n", "", "a\nb"],
  ["-erz", "-n12", "a", "b", ""], ["-i0-12", "-n5"],
  ["-i9007199254740993-18446744073709551615", "-n4"],
  ["-ri18446744073709551614-18446744073709551615", "-n8"],
  ["-i2-1"], ["-i1-0", "-r"], ["-i+1-+3", "-n2"], ["-i1- 3"],
  ["-e"], ["-er"], ["-ern0"], ["-e", "x", "-n1", "-n0"],
  ["-e", "a", "b", "-n999999999999999999999999999999"],
  ["-e", "x", "-n", " \t+1"], ["-e", "x", "--echo", "--rep", "--head-c=2"],
  ["-n0", "/missing"], ["-n0", "--random-source=/missing"],
  ["-rn0", "--random-source=/missing"], ["-e", "x", "--random-source=/missing"],
  ["--r"], ["--he"], ["--e=x"], ["--repeat=x"], ["--unknown"],
  ["-n"], ["-i"], ["-o"], ["--random-source"], ["-x"],
  ["-e", "-i1-2"], ["-i1-2", "x"], ["a", "b"],
  ["-i1-2", "-i1-2"], ["-o/a", "-o/b"],
  ["--random-source=a", "--random-source=b"],
  ["-n-1"], ["-n1x"], ["-n1 "], ["-n" , "x'y"], ["-n", "x\ny"],
  ["-i3-1"], ["-i0-18446744073709551615"],
  ["-i18446744073709551616-2"], ["-i1 -2"], ["-i-1-2"],
];

for (const args of cases) test(`GNU 9.7 argv ${JSON.stringify(args)}`, nativeOptions, async () => {
  const seeded = args.some(argument => argument.startsWith("--random-source")) ? args : [`--random-source=${randomPath}`, ...args];
  const expected = await native(seeded);
  const actual = await run(seeded);
  assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, stderrHex: actual.stderrHex }, expected);
});

for (const input of [Buffer.from("a\nb\nc\nd\ne\n"), Buffer.from([255, 0, 10, 128, 10, 10, 254]), Buffer.alloc(0)]) {
  for (const args of [[], ["-n2"], ["-n9"], ["-r", "-n9"], ["-z"], ["-z", "-n2"], ["-"], ["-n0"]]) {
    test(`GNU pipe ${JSON.stringify(args)} ${input.toString("hex")}`, nativeOptions, async () => {
      const seeded = [`--random-source=${randomPath}`, ...args];
      const actual = await run(seeded, input);
      assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, stderrHex: actual.stderrHex }, await native(seeded, input));
    });
  }
}

for (const random of [new Uint8Array(), Uint8Array.of(255), Uint8Array.of(255, 0), entropy.subarray(0, 2)]) {
  for (const args of [["-e", "a", "b", "c"], ["-ern20", "a", "b", "c"], ["-i0-18446744073709551614", "-n2"]]) {
    test(`GNU random exhaustion/rejection ${random.toString()} ${args}`, nativeOptions, async () => {
      const seeded = [`--random-source=${random.length ? randomPath : "/dev/null"}`, ...args];
      const actual = await run(seeded, undefined, random);
      assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, stderrHex: actual.stderrHex }, await native(seeded, undefined, random));
    });
  }
}

test("POSIXLY_CORRECT stops option permutation", async context => {
  const args = ["-e", "a", "-n1"];
  const actual = await run(args, undefined, undefined, { env: { POSIXLY_CORRECT: "" } });
  assert.deepEqual(actual.stdout.toString().trim().split("\n").sort(), ["-n1", "a"]);
  await context.test("GNU POSIXLY_CORRECT status", nativeOptions, async () => {
    assert.equal((await native(args, undefined, undefined, { POSIXLY_CORRECT: "" })).exitCode, actual.exitCode);
  });
});

test("version identity is an explicit GNU stdout parity exception", async context => {
  const actual = await run(["--version"]);
  assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, stderrHex: actual.stderrHex }, {
    exitCode: 0, stdout: Buffer.from("shuf (virtual-bash, GNU coreutils 9.7 profile)\n"), stderr: "", stderrHex: "",
  });
  await context.test("GNU version status and diagnostics remain exact", nativeOptions, async () => {
    const expected = await native(["--version"]);
    assert.equal(expected.stdout.toString().split("\n")[0], "shuf (GNU coreutils) 9.7");
    assert.equal(actual.exitCode, expected.exitCode);
    assert.equal(actual.stderr, expected.stderr);
    assert.equal(actual.stderrHex, expected.stderrHex);
    assert.notDeepEqual(actual.stdout, expected.stdout);
  });
});

for (const args of [["--help"], ["--help", "--bad"], ["--e=x"], ["--r=x"], ["--he=2"], ["--input-r"], ["a b"], ["a'b"], ["a\nb"], ["/"], ["-n0", "-o/"], ["-n0", "-o/missing/path"], ["--random-source=/", "-e", "a", "b"]]) {
  test(`GNU ancillary/diagnostic ${JSON.stringify(args)}`, nativeOptions, async () => {
    const actual = await run(args);
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, stderrHex: actual.stderrHex }, await native(args));
  });
}

for (const args of [["é"], ["😀"], ["-n", "é"], ["-é"], ["--é"], ["--=x"], [""], ["-en0", "-o" , ""], ["-e", "x", "--random-source="], ["-i0-18446744073709551616x"], ["-i18446744073709551616-foo"], ["/dev/null/"], ["-n0", "-o/dev/null/"], ["-e", "x", "--random-source=/dev/null/"]]) {
  test(`GNU byte diagnostics and empty paths ${JSON.stringify(args)}`, nativeOptions, async () => {
    const actual = await run(args);
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, stderrHex: actual.stderrHex }, await native(args));
  });
}

for (const code of Array.from({ length: 127 }, (_, index) => index + 1)) {
  test(`GNU C quoting byte ${code}`, nativeOptions, async () => {
    const name = `missing${String.fromCharCode(code)}name`;
    const actual = await run([name]);
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr, stderrHex: actual.stderrHex }, await native([name]));
  });
}
