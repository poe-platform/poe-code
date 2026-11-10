import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { fixture, run } from "./helpers.js";

test("uniq +N skips characters instead of reading a same-named file", async () => {
  for (const [stdin, expected] of [["A x\nB x\nC y", "A x\nC y\n"], ["aX id\nbY id\n", "aX id\nbY id\n"]] as const) {
    for (const args of [["+1"], ["-s1"], ["-s", "+1"], ["--skip-chars", "+1"]]) {
      const fs = await fixture({ "+1": "named\n", out: "KEEP", "-": "DASH" });
      const result = await run("uniq", args, { fs, stdin, env: { LC_ALL: "C" }, commands: textCommands() });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
      for (const [name, contents] of [["+1", "named\n"], ["out", "KEEP"], ["-", "DASH"]]) {
        assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${name}`)), contents);
      }
    }
  }
});

test("uniq +N respects the POSIX version and explicit filename forms", async () => {
  for (const version of [undefined, "199209", "200111", "200112", "200808", "200809", "202405", "invalid", "200112junk"]) {
    for (const args of [["+1"], ["--", "+1"], ["./+1"]]) {
      const fs = await fixture({ "+1": "named\n" });
      const env = { LC_ALL: "C", ...(version === undefined ? {} : { _POSIX2_VERSION: version }) };
      const result = await run("uniq", args, { fs, stdin: "A x\nB x\nC y", env, commands: textCommands() });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, args.length > 1 || args[0] === "./+1" || version === "200112" || version === "200808" ? "named\n" : "A x\nC y\n", `${version}: ${args.join(" ")}`);
    }
  }
});

test("uniq applies +N in argument order without rewriting option values", async () => {
  for (const [args, expected] of [
    [["+1", "-s0"], "A x\nB x\nC y\n"],
    [["-s0", "+1"], "A x\nC y\n"],
    [["+0", "+1"], "A x\nC y\n"],
    [["+1", "+0"], "A x\nB x\nC y\n"],
    [["-", "+1"], "A x\nC y\n"],
    [["-f", "+1"], "A x\nC y\n"],
    [["--skip-fields", "+1"], "A x\nC y\n"],
    [["-cw", "+1"], "      1 A x\n      1 B x\n      1 C y\n"],
    [["--check-chars", "+1"], "A x\nB x\nC y\n"],
  ] as const) {
    const result = await run("uniq", args, { stdin: "A x\nB x\nC y", env: { LC_ALL: "C" }, commands: textCommands() });
    assert.equal(result.exitCode, 0, args.join(" "));
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected, args.join(" "));
  }
});

test("uniq keeps nonnumeric plus operands and output filenames intact", async () => {
  for (const name of ["+", "+1x", "+1.0", "+-1"]) {
    const fs = await fixture({ [name]: "named\n", out: "KEEP" });
    const result = await run("uniq", [name, "out"], { fs, commands: textCommands() });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/out")), "named\n");
  }
  for (const args of [["+1", "in", "out"], ["in", "+1", "out"], ["in", "out", "+1"]]) {
    const fs = await fixture({ in: "A x\nB x\nC y", out: "KEEP", "+1": "named\n" });
    const result = await run("uniq", args, { fs, env: { LC_ALL: "C" }, commands: textCommands() });
    assert.equal(result.exitCode, 0, args.join(" "));
    assert.equal(result.stdout, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/out")), "A x\nC y\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/+1")), "named\n");
  }
});
