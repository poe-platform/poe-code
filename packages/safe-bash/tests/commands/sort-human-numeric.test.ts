import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { SortRecordBudget } from "../../src/commands/sort-admission.js";
import { toByteSource, type ByteSource, type CommandContext } from "../../src/contracts/index.js";
import { registerYieldCheckpoint, scheduleTurn } from "../../src/contracts/yield.js";
import { chunks, fixture, run } from "./helpers.js";
import { Shell } from "../../src/shell/shell.js";
import { agentCommands } from "../../src/plugins/index.js";

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

test("sort rejects incompatible ordering modes and retains its C numeric profile", async () => {
  for (const args of [["-hg"], ["-gh"], ["-ng"], ["-h", "--general-numeric-sort"], ["-h", "-V"]]) {
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

test("sort supports reported ordering options and long aliases", async () => {
  for (const [args, stdin, expected] of [
    [["-V"], "v10\nv2\nv1\n", "v1\nv2\nv10\n"],
    [["--sort=version"], "v10\nv2\n", "v2\nv10\n"],
    [["--version-sort"], "v10\nv2\n", "v2\nv10\n"],
    [["-g"], "1e2\n3\n-2e1\n", "-2e1\n3\n1e2\n"],
    [["--general-numeric-sort"], "1e2\n3\n-2e1\n", "-2e1\n3\n1e2\n"],
    [["-M"], "Dec\nFeb\nJan\n", "Jan\nFeb\nDec\n"],
    [["--month-sort"], "dec\n FEB\nJan\nunknown\n", "unknown\nJan\n FEB\ndec\n"],
    [["-d"], "a-b\naa\na!\n", "a!\naa\na-b\n"],
    [["--dictionary-order"], "a-b\naa\na!\n", "a!\naa\na-b\n"],
    [["-i"], "ab\na\u0001a\n", "a\u0001a\nab\n"],
    [["--ignore-nonprinting"], "ab\na\u0001a\n", "a\u0001a\nab\n"],
  ] as const) {
    const result = await run("sort", args, { stdin: chunks(stdin) });
    assert.equal(result.exitCode, 0, args.join(" "));
    assert.equal(result.stdout, expected, args.join(" "));
    assert.equal(result.stderr, "");
  }
});

test("sort ordering modes apply to keys, stable ties, uniqueness, reverse and checks", async () => {
  for (const [args, stdin, expected] of [
    [["-t:", "-k2,2V"], "a:v10\nb:v2\n", "b:v2\na:v10\n"],
    [["-t:", "-k2,2g", "-s"], "a:1e2\nb:3\nc:100\n", "b:3\na:1e2\nc:100\n"],
    [["-t:", "-k2,2Mr"], "a:Jan\nb:Dec\n", "b:Dec\na:Jan\n"],
    [["-du"], "a-b\nab\na!\n", "a!\na-b\n"],
    [["-is"], "a\u0001b\nab\n", "a\u0001b\nab\n"],
    [["--sort", "general-numeric", "-r"], "1e2\n3\n-2e1\n", "1e2\n3\n-2e1\n"],
    [["-gs"], "1\nNaN\nword\n-inf\n+2.5e1x\ninf\n", "word\nNaN\n-inf\n1\n+2.5e1x\ninf\n"],
    [["-g"], "0x10\n0x2\n0x1.8p2\n-0x1p3\n", "-0x1p3\n0x2\n0x1.8p2\n0x10\n"],
    [["-Vs"], "v001\nv1\nv0002\nv2\n", "v001\nv1\nv0002\nv2\n"],
    [["-V"], "a1\na~1\na\n.\n..\n.hidden\n", ".\n..\n.hidden\na~1\na\na1\n"],
    [["-Vz"], "v10\u0000v2\u0000", "v2\u0000v10\u0000"],
  ] as const) {
    const result = await run("sort", args, { stdin });
    assert.equal(result.exitCode, 0, args.join(" "));
    assert.equal(result.stdout, expected, args.join(" "));
  }
  assert.equal((await run("sort", ["-Vc"], { stdin: "v2\nv10\n" })).exitCode, 0);
  assert.equal((await run("sort", ["-gc"], { stdin: "1e2\n3\n" })).exitCode, 1);
  assert.equal((await run("sort", ["--sort=unknown"], { stdin: "a\n" })).exitCode, 2);
  assert.equal((await run("sort", ["-Sversion"], { stdin: "a\n" })).exitCode, 2);
});

test("reported sort options work through the public agent command shell", async () => {
  const fs = await fixture({ versions: "v10\nv2\nv1\n", numbers: "1e2\n3\n-2e1\n", months: "Dec\nFeb\nJan\n", dictionary: "a-b\naa\na!\n", nonprinting: "ab\na\u0001a\n", input: "a\nc\n", second: "b\nd\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  for (const [command, expected] of [
    ["sort -V versions", "v1\nv2\nv10\n"],
    ["sort --sort=version versions", "v1\nv2\nv10\n"],
    ["sort -g numbers", "-2e1\n3\n1e2\n"],
    ["sort -M months", "Jan\nFeb\nDec\n"],
    ["sort -d dictionary", "a!\naa\na-b\n"],
    ["sort -i nonprinting", "a\u0001a\nab\n"],
    ["sort -m input second", "a\nb\nc\nd\n"],
  ] as const) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  }
});

test("sort merge combines runs without sorting within each file", async () => {
  const fs = await fixture({ input: "a\nc\n", second: "b\nd\n", unsorted: "c\na\n", versions: "v2\nv10\n" });
  for (const args of [["-m"], ["--merge"]]) {
    assert.equal((await run("sort", [...args, "input", "second"], { fs })).stdout, "a\nb\nc\nd\n");
    assert.equal((await run("sort", [...args, "unsorted", "second"], { fs })).stdout, "b\nc\na\nd\n");
  }
  assert.equal((await run("sort", ["-mVu", "versions", "-"], { fs, stdin: "v1\nv2\n" })).stdout, "v1\nv2\nv10\n");
  assert.equal((await run("sort", ["-m", "-o", "input", "input", "second"], { fs })).exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/work/input")).toString(), "a\nb\nc\nd\n");
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

test("sort comparison and numeric parsing paths preserve queued cancellation", async () => {
  for (const args of [[], ["-h"], ["-k1,1h"], ["-k1,1n"], ["-hf"], ["-bh"], ["-hc"], ["-g"], ["-V"], ["-d"], ["-i"], ["-M"]]) {
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

for (const args of [["-h"], ["-n"], ["-k", "1,1"], ["-k", "1,1h"], ["-k", "1,1n"], ["-k", "1,1hr"]]) {
  for (const longSide of ["left", "right"]) test(`sort ${args.join(" ")} awaits the original ${longSide} key checkpoint`, async () => {
    for (const reason of [false, null]) {
      const controller = new AbortController();
      const fs = await fixture({ kept: "unchanged" });
      const long = "1".repeat(8192) + "M";
      const stdin = longSide === "left" ? `${long}\n2M\n` : `2M\n${long}\n`;
      let checkpoints = 0;
      registerYieldCheckpoint(controller.signal, () => { checkpoints++; scheduleTurn(() => controller.abort(reason)); });
      await assert.rejects(run("sort", [...args, "-o", "kept"], { fs, stdin, signal: controller.signal }), error => error === reason);
      assert.equal(checkpoints, 1);
      assert.equal(Buffer.from(await fs.readFile("/work/kept")).toString(), "unchanged");
    }
  });
}

test("sort human numeric warmed descriptors keep yielding without replacing cached keys", async testContext => {
  const stdin = Array.from({ length: 128 }, (_, index) => `${String(index * 73 % 128).padStart(3, "0")}K`).join("\n") + "\n";
  for (const args of [["-h"], ["-k1,1h"]]) {
    const controller = new AbortController();
    const reason = new Error("cancel warmed human keys");
    const cachedRecords = new Set<Uint8Array>();
    let insertions = 0;
    const set = Map.prototype.set;
    const cache = testContext.mock.method(Map.prototype, "set", function(this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (key instanceof Uint8Array && value !== null && typeof value === "object" && "whole" in value && "fraction" in value && "suffixRank" in value) {
        cachedRecords.add(key);
        insertions++;
      }
      return set.call(this, key, value);
    });
    let warmed = false;
    registerYieldCheckpoint(controller.signal, () => {
      if (cachedRecords.size === 128) {
        warmed = true;
        queueMicrotask(() => controller.abort(reason));
      }
    });
    try {
      await assert.rejects(run("sort", args, { stdin, signal: controller.signal }), failure => failure === reason);
      assert.equal(warmed, true);
      assert.equal(cachedRecords.size, 128);
      assert.equal(insertions, 128);
    } finally { cache.mock.restore(); }
  }
});
