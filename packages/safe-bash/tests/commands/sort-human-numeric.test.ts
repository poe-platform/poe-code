import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { SortRecordBudget } from "../../src/commands/sort-admission.js";
import { toByteSource, type ByteSource, type CommandContext } from "../../src/contracts/index.js";
import { registerYieldCheckpoint, scheduleTurn } from "../../src/contracts/yield.js";
import { chunks, fixture, run } from "./helpers.js";

test("sort human numeric supports short and long options for mixed suffixes", async () => {
  for (const args of [["-h"], ["--human-numeric-sort"]]) {
    const result = await run("sort", args, { stdin: chunks("2G\n345M\n1.2K\n900\n") });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "900\n1.2K\n345M\n2G\n");
    assert.equal(result.stderr, "");
  }
});

test("sort human numeric orders signs then suffix ranks rather than scaled magnitudes", async () => {
  const result = await run("sort", ["-hs"], { stdin: "1G\n2000M\n-1G\n-2000M\n0G\n-0M\n0\n1K\n10000\n" });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "-1G\n-2000M\n0G\n-0M\n0\n10000\n1K\n2000M\n1G\n");
});

test("sort human numeric recognizes k and uppercase suffixes without implicitly folding case", async () => {
  const result = await run("sort", ["-hs"], { stdin: "1m\n2K\n1k\n1M\n1g\n1G\n1t\n" });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1m\n1g\n1t\n1k\n2K\n1M\n1G\n");
  assert.equal((await run("sort", ["-hfs"], { stdin: "2m\n1K\n1M\n" })).stdout, "1K\n1M\n2m\n");
  assert.equal((await run("sort", ["-h"], { stdin: "1Q\n1R\n1Y\n1Z\n1E\n1P\n1T\n1G\n1M\n1K\n1\n" })).stdout,
    "1\n1K\n1M\n1G\n1T\n1P\n1E\n1Z\n1Y\n1R\n1Q\n");
});

test("sort human numeric retains decimal prefix and numerical zero semantics", async () => {
  const result = await run("sort", ["-hs"], { stdin: "K\nM\n.K\n-.K\n0K\n+1G\n-0.00M\n.1K\n-.1K\n1e3G\n1 K\n" });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "-.1K\nK\nM\n.K\n-.K\n0K\n+1G\n-0.00M\n1e3G\n1 K\n.1K\n");
  assert.equal((await run("sort", ["-h"], { stdin: "\t1.2K\n 1.1K\n.9K\n" })).stdout, ".9K\n 1.1K\n\t1.2K\n");
});

test("sort human numeric preserves huge integers and fractional precision in both signs", async () => {
  const large = "9".repeat(256);
  const input = [`${large}1M`, `${large}0M`, "9007199254740993K", "9007199254740992K", "1.00000000000000000002K", "1.00000000000000000001K", "-1.00000000000000000001K", "-1.00000000000000000002K", `-${large}0M`, `-${large}1M`];
  const result = await run("sort", ["-h"], { stdin: input.join("\n") + "\n" });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, [input[9], input[8], input[7], input[6], input[5], input[4], input[3], input[2], input[1], input[0]].join("\n") + "\n");
});

test("sort human numeric preserves stable unique reverse and last-resort byte ties", async () => {
  const stdin = "1k b\n1K a\n1.0K c\n0M z\n0G a\n";
  for (const [args, expected] of [
    [["-hs"], "0M z\n0G a\n1k b\n1K a\n1.0K c\n"],
    [["-h"], "0G a\n0M z\n1.0K c\n1K a\n1k b\n"],
    [["-hu"], "0M z\n1k b\n"],
    [["-hrs"], "1k b\n1K a\n1.0K c\n0M z\n0G a\n"],
    [["-hru"], "1k b\n0M z\n"],
  ] as const) {
    const result = await run("sort", args, { stdin });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
  }
});

test("sort human numeric applies inherited and explicit key flags with existing local precedence", async () => {
  const stdin = "a:2G\nb:11M\nc:2G\n";
  for (const [args, expected] of [
    [["-h", "-t", ":", "-k2,2", "-s"], "b:11M\na:2G\nc:2G\n"],
    [["-r", "-t", ":", "-k2,2h", "-s"], "b:11M\na:2G\nc:2G\n"],
    [["-t", ":", "-k2,2hr", "-s"], "a:2G\nc:2G\nb:11M\n"],
    [["-h", "-t", ":", "-k2,2n", "-s"], "a:2G\nc:2G\nb:11M\n"],
    [["-n", "-t", ":", "-k2,2h", "-u"], "b:11M\na:2G\n"],
    [["-h", "-t", ":", "-k2,2r", "-s"], "a:2G\nc:2G\nb:11M\n"],
    [["-t", ":", "-k2h,2", "-k1,1r"], "b:11M\nc:2G\na:2G\n"],
  ] as const) {
    const result = await run("sort", args, { stdin });
    assert.equal(result.exitCode, 0, args.join(" "));
    assert.equal(result.stdout, expected, args.join(" "));
  }
  assert.equal((await run("sort", ["-h", "-t", ":", "-k2.2,2"], { stdin: "a:x2G\nb:x11M\n" })).stdout, "b:x11M\na:x2G\n");
  assert.equal((await run("sort", ["-t", ":", "-k2,2hf"], { stdin: "a:2m\nb:1K\n" })).stdout, "b:1K\na:2m\n");
  assert.equal((await run("sort", ["-bh"], { stdin: " 2G\n 11M\n" })).stdout, " 11M\n 2G\n");
});

test("sort rejects h plus n on effective flag sets but permits explicit key overrides", async () => {
  for (const args of [["-hn"], ["-nh"], ["--human-numeric-sort", "--numeric-sort"], ["-k1,1hn"], ["-k1h,1n"], ["-hn", "-k1,1"]]) {
    let reads = 0;
    const stdin = { async *[Symbol.asyncIterator]() { reads++; yield Buffer.from("2G\n1M\n"); } };
    const result = await run("sort", args, { stdin });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "sort: options '-hn' are incompatible\n");
    assert.equal(reads, 0);
  }
  for (const args of [["-hn", "-k1,1h"], ["-nh", "-k1,1n"], ["-hn", "-k1,1r"]]) {
    const result = await run("sort", args, { stdin: "2G\n11M\n" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, args[1] === "-k1,1h" ? "11M\n2G\n" : "2G\n11M\n");
  }
});

test("sort human numeric does not add general numeric or locale profiles", async () => {
  for (const args of [["-g"], ["-hg"], ["-gh"], ["-ng"], ["-h", "--general-numeric-sort"], ["-k1,1g"], ["-h", "-V"]]) {
    const result = await run("sort", args, { stdin: "2G\n1M\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  }
  for (const locale of ["C", "de_DE.UTF-8"]) {
    const result = await run("sort", ["-hs"], { stdin: "1,5M\n2K\n", env: { LC_ALL: locale } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "1,5M\n2K\n");
  }
  assert.equal((await run("sort", ["-n"], { stdin: "2G\n11M\n" })).stdout, "2G\n11M\n");
});

test("sort human numeric checks order and duplicate keys without output", async () => {
  for (const [args, stdin, status] of [
    [["-hc"], "11M\n2G\n", 0],
    [["-hc"], "2G\n11M\n", 1],
    [["-hsc"], "1k\n1K\n", 0],
    [["-huc"], "1k\n1K\n", 1],
    [["-k1,1h", "-c"], "2G\n11M\n", 1],
  ] as const) {
    const result = await run("sort", args, { stdin });
    assert.equal(result.exitCode, status);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, status === 1 ? "sort: disorder at record 2\n" : "");
  }
});

test("sort human numeric preserves raw NUL records and reused producer byte ownership", async () => {
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
    const bytes = Uint8Array.from([50, 71, 255, 0]);
    yield bytes;
    bytes.set([49, 77, 128, 0]);
    yield bytes;
    bytes.fill(88);
  } };
  const result = await run("sort", ["-hz"], { stdin });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdoutBytes, Buffer.from([49, 77, 128, 0, 50, 71, 255, 0]));
  assert.equal((await run("sort", ["-hz"], { stdin: "2G\u0000\u00001M" })).stdout, "\u00001M\u00002G\u0000");
});

test("sort human numeric reads before replacing memory output and retains input error status", async () => {
  const fs = await fixture({ sizes: "2G\n11M\n", kept: "unchanged" });
  const result = await run("sort", ["-h", "-o", "sizes", "sizes"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(Buffer.from(await fs.readFile("/work/sizes")).toString(), "11M\n2G\n");
  assert.equal((await run("sort", ["-h", "-o", "kept", "missing"], { fs })).exitCode, 2);
  assert.equal(Buffer.from(await fs.readFile("/work/kept")).toString(), "unchanged");
});

test("sort human numeric retains record admission before retaining payloads", async testContext => {
  const original = SortRecordBudget.prototype.admit;
  let admissions = 0;
  testContext.mock.method(SortRecordBudget.prototype, "admit", function (this: SortRecordBudget, size: number) {
    admissions++;
    if (admissions === 1) original.call(this, 32 * 1024 * 1024 - 2);
    original.call(this, size);
  });
  const result = await run("sort", ["-h"], { stdin: "1M\n2G\n" });
  assert.equal(result.exitCode, 2);
  assert.equal(admissions, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "sort: EFBIG: sort buffer limit exceeded\n");
});

test("sort human numeric parsing paths preserve queued cancellation", async () => {
  for (const args of [["-h"], ["-k1,1h"], ["-hf"], ["-bh"], ["-hc"]]) {
    for (const reason of [false, null]) {
      const controller = new AbortController();
      const fs = await fixture({ kept: "unchanged" });
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const context: CommandContext = {
        command: "sort", args: [...args, "-o", "kept"], cwd: "/work", env: {}, fs,
        signal: controller.signal, stdin: toByteSource(`${"1".repeat(8192)}2M\n${"1".repeat(8192)}3M\n`),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
      };
      let checkpoints = 0;
      registerYieldCheckpoint(controller.signal, () => { checkpoints++; scheduleTurn(() => controller.abort(reason)); });
      await assert.rejects(Promise.resolve(textCommands().find(command => command.name === "sort")!.execute(context)), failure => failure === reason);
      assert.equal(checkpoints, 1);
      assert.equal(stdout.length, 0);
      assert.equal(stderr.length, 0);
      assert.equal(Buffer.from(await fs.readFile("/work/kept")).toString(), "unchanged");
    }
  }
});

test("sort human numeric warmed descriptors keep yielding without reparsing retained keys", async testContext => {
  const stdin = Array.from({ length: 128 }, (_, index) => `${String(index * 73 % 128).padStart(3, "0")}K`).join("\n") + "\n";
  for (const args of [["-h"], ["-k1,1h"]]) {
    const controller = new AbortController();
    const reason = new Error("cancel warmed human keys");
    const from = testContext.mock.method(Buffer, "from");
    let warmed = false;
    registerYieldCheckpoint(controller.signal, () => {
      const parsed = from.mock.calls.filter(call => call.arguments[0] instanceof Uint8Array);
      if (parsed.length === 128) {
        warmed = true;
        queueMicrotask(() => controller.abort(reason));
      }
    });
    try {
      await assert.rejects(run("sort", args, { stdin, signal: controller.signal }), failure => failure === reason);
      assert.equal(warmed, true);
      assert.equal(from.mock.calls.filter(call => call.arguments[0] instanceof Uint8Array).length, 128);
    } finally { from.mock.restore(); }
  }
});
