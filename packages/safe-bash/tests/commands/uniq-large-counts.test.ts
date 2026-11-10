import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { chunks, fixture, run } from "./helpers.js";

const commands = textCommands();
const counts = ["9007199254740991", "9007199254740992", "18446744073709551615", "18446744073709551616", "9".repeat(400)];

for (const [short, long] of [["f", "skip-fields"], ["s", "skip-chars"], ["w", "check-chars"]] as const) {
  for (const locale of ["C", "C.utf8"]) {
    test(`uniq -${short} accepts oversized counts in ${locale}`, async () => {
      for (const count of counts) {
        for (const args of [[`-${short}`, count], [`-${short}${count}`], [`--${long}`, `+${count}`], [`--${long}=${count}`]]) {
          const result = await run("uniq", args, { commands, stdin: chunks("A x\nB x\nC y"), env: { LC_ALL: locale } });
          assert.equal(result.exitCode, 0, `${args.join(" ")}: ${result.stderr}`);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, short === "w" ? "A x\nB x\nC y\n" : "A x\n");
        }
      }
    });

    test(`uniq -${short} bounds oversized counts on empty, UTF-8 and invalid records in ${locale}`, async () => {
      const input = Buffer.from("00c3a9207800ff207900", "hex");
      const result = await run("uniq", ["-z", `-${short}`, counts.at(-1)!], { commands, stdin: chunks(input), env: { LC_ALL: locale } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, short === "w" ? input : Buffer.from([0]));
    });
  }

  test(`uniq -${short} accepts oversized counts with named input and output`, async () => {
    const fs = await fixture({ in: "A x\nB x\nC y", out: "KEEP", "-": "DASH", "+1": "named\n" });
    const result = await run("uniq", [`--${long}=${counts.at(-1)!}`, "in", "out"], { commands, fs, env: { LC_ALL: "C" } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "");
    assert.equal(Buffer.from(await fs.readFile("/work/out")).toString(), short === "w" ? "A x\nB x\nC y\n" : "A x\n");
    for (const [path, expected] of [["in", "A x\nB x\nC y"], ["-", "DASH"], ["+1", "named\n"]]) {
      assert.equal(Buffer.from(await fs.readFile(`/work/${path}`)).toString(), expected);
    }
  });

  test(`uniq -${short} still rejects malformed counts without replacing output`, async () => {
    for (const count of ["-1", "", "+", "1.5", "1e20", "Infinity", `${counts.at(-1)!}x`]) {
      const fs = await fixture({ in: "A x\nB x\nC y", out: "KEEP" });
      const result = await run("uniq", [`--${long}=${count}`, "in", "out"], { commands, fs });
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.stdout, "");
      assert.notEqual(result.stderr, "");
      assert.equal(Buffer.from(await fs.readFile("/work/out")).toString(), "KEEP");
    }
  });
}

test("uniq combines oversized skips and widths and retains ordinary counts", async () => {
  for (const [args, expected] of [
    [["-f1", "-w9"], "A x\nC y\n"],
    [["-w0"], "A x\n"],
    [["-f0", "-s0", "-w9"], "A x\nB x\nC y\n"],
    [["-f1", `-s${counts.at(-1)!}`, `-w${counts.at(-1)!}`], "A x\n"],
    [[`-f${counts.at(-1)!}`, "-s1", "-w1"], "A x\n"],
  ] as const) {
    const result = await run("uniq", args, { commands, stdin: "A x\nB x\nC y" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});
