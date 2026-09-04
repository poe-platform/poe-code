import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";
import { parseArguments } from "../../../src/commands/truncate/arguments.js";

for (const [args, diagnostic] of [
  [["--siz"], "option '--size' requires an argument"],
  [["--no=1"], "option '--no-create' doesn't allow an argument"],
  [["--he=1"], "option '--help' doesn't allow an argument"],
  [["-help"], "invalid option -- 'h'"],
  [["-version"], "invalid option -- 'v'"],
  [["--=1"], "option '--=1' is ambiguous; possibilities: '--no-create' '--io-blocks' '--reference' '--size' '--help' '--version'"],
] as const) {
  test(`oracle exact option diagnostic ${args[0]}`, async () => {
    assert.deepEqual(await run(args), { exitCode: 1, stdout: "", stderr: `truncate: ${diagnostic}\nTry 'truncate --help' for more information.\n` });
  });
}

for (const [input, rendered] of [["1\n", "'1\\n'"], ["1'", "'1\\''"], ["1é", "'1\\303\\251'"], ["1\\", "'1\\\\'"]] as const) {
  test(`oracle numeric C-locale quoting ${JSON.stringify(input)}`, async () => {
    assert.equal((await run(["-s", input, "file"])).stderr, `truncate: Invalid number: ${rendered}\n`);
  });
}

for (const [path, rendered] of [["a\nb", "'a'$'\\n''b/missing'"], ["é", "''$'\\303\\251''/missing'"], ["a'b", '"a\'b/missing"'], ["a'b$", "'a'\\''b$/missing'"]] as const) {
  test(`oracle path shell-escape quoting ${JSON.stringify(path)}`, async () => {
    assert.equal((await run(["-s0", `${path}/missing`])).stderr, `truncate: cannot open ${rendered} for writing: No such file or directory\n`);
  });
}

for (const [prefix, power] of [["k", 1], ["K", 1], ["m", 2], ["M", 2], ["g", 3], ["G", 3], ["t", 4], ["T", 4], ["P", 5], ["E", 6], ["Z", 7], ["Y", 8], ["R", 9], ["Q", 10]] as const) {
  for (const suffix of ["", "B", "D", "iB"]) {
    test(`complete GNU multiplier grammar ${prefix}${suffix}`, () => {
      const multiplier = (suffix === "B" || suffix === "D" ? 1000n : 1024n) ** BigInt(power);
      assert.equal(parseArguments([`-s0${prefix}${suffix}`, "file"], false).size, 0n);
      if (multiplier <= (1n << 63n) - 1n) {
        assert.equal(parseArguments([`-s${prefix}${suffix}`, "file"], false).size, multiplier);
        assert.equal(parseArguments([`-s-1${prefix}${suffix}`, "file"], false).size, -multiplier);
      } else assert.throws(() => parseArguments([`-s1${prefix}${suffix}`, "file"], false), /Invalid number/u);
    });
  }
}

test("signed 64-bit endpoints and retained GNU modifiers are parsed exactly", () => {
  assert.equal(parseArguments(["-s-9223372036854775808", "file"], false).size, -(1n << 63n));
  assert.equal(parseArguments(["-s9223372036854775807", "file"], false).size, (1n << 63n) - 1n);
  assert.equal(parseArguments(["-s+1", "-s3", "file"], false).mode, "relative");
  assert.equal(parseArguments(["-s/1", "-s3", "file"], false).mode, "/");
  assert.equal(parseArguments(["-s+1", "-s%3", "file"], false).mode, "%");
  assert.throws(() => parseArguments(["-s/1", "-s0", "file"], false), /division by zero/u);
});

for (const unit of ["Z", "Y", "R", "Q"]) {
  for (const ending of ["", "B", "D", "iB"]) {
    for (const coefficient of ["", "1"]) {
      const size = `${coefficient}${unit}${ending}`;
      test(`GNU 9.7 Darwin C overflow remains a failure with exact stderr: ${size}`, async () => {
        assert.deepEqual(await run(["-cs", size, "absent"]), {
          exitCode: 1,
          stdout: "",
          stderr: `truncate: Invalid number: '${size}': Value too large to be stored in data type\n`,
        });
      });
    }
  }
}
