import assert from "node:assert/strict";
import test from "node:test";
import { jsonEvents, virtual } from "./helpers.js";
import { setup } from "../../shell/helpers.js";
import { rgCommand } from "../../../src/commands/search/rg.js";
import { Limits } from "../../../src/commands/search/shared.js";

for (const option of ["-h", "--help", "-V", "--version"]) {
  test(`Shell rg ${option} succeeds without searching or reading pattern files`, async () => {
    const { shell, commands, fs } = setup();
    commands.register(rgCommand());
    fs.readFile = async () => { throw new Error("informational options must not read files"); };
    fs.readdir = async () => { throw new Error("informational options must not traverse files"); };
    const result = await shell.exec(`rg ${option} -f missing /missing`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    const bare = await shell.exec(`rg ${option}`);
    assert.equal(bare.exitCode, 0);
    assert.equal(bare.stderr, "");
    assert.equal(bare.stdout, result.stdout);
    if (option === "-h" || option === "--help") {
      assert.ok(result.stdout.startsWith("Usage: rg "));
      assert.ok(result.stdout.includes("-V, --version"));
    } else {
      assert.ok(result.stdout.startsWith("rg (safe-bash bounded implementation)\n"));
      assert.ok(!result.stdout.includes("15.2.0"));
      if (option === "--version") assert.ok(result.stdout.includes("Regex engine: bounded ASCII regular expressions and UTF-8 literals"));
    }
  });
}

test("rg informational long options reject values and respect end of options", async () => {
  for (const args of [["--help=yes"], ["--version=yes"], ["--", "-V", "missing"], ["--", "-h", "missing"], ["--", "--version", "missing"]]) {
    const result = await virtual({ args });
    assert.equal(result.code, 2);
    assert.equal(result.stdout.length, 0);
  }
});

test("rg long version describes configured executors without inventing their capabilities", async () => {
  const result = await virtual({ args: ["--version"] });
  assert.equal(result.code, 0);
  assert.ok(result.stdout.toString().includes("configured bounded regex executor (capabilities depend on provider)"));
  assert.equal(result.stderr.length, 0);
});

test("deterministic virtual results do not depend on native rg availability", async () => {
  const result = await virtual({ args: ["-n", "-g", "*.ts", "TODO", "."], files: { "src/a.ts": "x\n// TODO: implement\n", "src/b.js": "TODO\n", "src/.ignore": "*.js\n" } });
  assert.equal(result.code, 0);
  assert.equal(result.stdout.toString(), "./src/a.ts:2:// TODO: implement\n");
  assert.equal(result.stderr.length, 0);
});

test("JSON schema uses original invalid bytes and byte offsets", async () => {
  const result = await virtual({ args: ["--json", "cat", "-"], stdin: Buffer.from([255, 99, 97, 116, 10]) });
  const events = jsonEvents(result.stdout) as { type: string; data: Record<string, unknown> }[];
  assert.deepEqual(events.map(event => event.type), ["begin", "match", "end", "summary"]);
  assert.deepEqual(events[1]!.data.lines, { bytes: "/2NhdAo=" });
  assert.deepEqual(events[1]!.data.submatches, [{ match: { text: "cat" }, start: 1, end: 4 }]);
});

for (const flag of ["-c", "-q", "-l"]) test(`rg --stats counts every occurrence and searches all files with ${flag}`, async () => {
  const { shell, commands, fs } = setup();
  commands.register(rgCommand());
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", Buffer.from("foo foo\nbar\nfoo\n"));
  await fs.writeFile("/work/other", Buffer.from("absent\n"));
  try {
    const result = await shell.exec(`rg --stats ${flag} foo /work`);
    assert.equal(result.exitCode, 0, result.stderr);
    const normal = flag === "-c" ? "/work/input:2\n" : flag === "-l" ? "/work/input\n" : "";
    assert.equal(result.stdout, normal + "\n3 matches\n2 matched lines\n1 files contained matches\n2 files searched\n0 bytes printed\n23 bytes searched\n0.000000 seconds spent searching\n0.000000 seconds total\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("rg --stats observes occurrence counts on streamed input and --no-stats disables reporting", async () => {
  const result = await virtual({ args: ["--stats", "-c", "foo", "-"], stdin: "foo foo\nfoo" });
  assert.equal(result.code, 0, result.stderr.toString());
  assert.match(result.stdout.toString(), /^2\n\n3 matches\n2 matched lines\n1 files contained matches\n1 files searched\n0 bytes printed\n11 bytes searched\n/u);
  const disabled = await virtual({ args: ["--stats", "--no-stats", "foo", "-"], stdin: "foo\n" });
  assert.equal(disabled.code, 0, disabled.stderr.toString());
  assert.equal(disabled.stdout.toString(), "foo\n");
  const printed = await virtual({ args: ["--stats", "foo", "-"], stdin: "foo foo\n" });
  assert.equal(printed.code, 0, printed.stderr.toString());
  assert.match(printed.stdout.toString(), /^foo foo\n\n2 matches\n1 matched lines\n1 files contained matches\n1 files searched\n8 bytes printed\n8 bytes searched\n/u);
});

test("literal memory-file search accounts for each line and stops quiet searches at the first match", async context => {
  const { shell, commands, fs } = setup();
  commands.register(rgCommand());
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", Buffer.from("foo\nmiss\nfoo\n"));
  const tick = Limits.prototype.tick;
  let ticks = 0;
  let yieldAt = Infinity;
  let entered!: () => void;
  let release!: () => void;
  const yielding = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  context.mock.method(Limits.prototype, "tick", function(this: Limits) {
    if (++ticks === yieldAt) { entered(); return gate; }
    return tick.call(this);
  });
  try {
    const inventory = await shell.exec("rg --files /work");
    assert.equal(inventory.exitCode, 0, inventory.stderr);
    const walkTicks = ticks;
    ticks = 0;
    const counted = await shell.exec("rg -c foo /work");
    assert.equal(counted.exitCode, 0, counted.stderr);
    assert.equal(counted.stdout, "/work/input:2\n");
    assert.equal(ticks, walkTicks + 3, "each of the three searched lines must consume a checkpoint");
    ticks = 0;
    const quiet = await shell.exec("rg -q foo /work");
    assert.equal(quiet.exitCode, 0, quiet.stderr);
    assert.equal(quiet.stdout, "");
    assert.equal(ticks, walkTicks + 1, "quiet search must stop before the two remaining lines");
    ticks = 0;
    yieldAt = walkTicks + 1;
    let settled = false;
    const pending = shell.exec("rg --stats -c foo /work").finally(() => { settled = true; });
    try {
      await Promise.race([yielding, pending.then(() => assert.fail("search completed without yielding"))]);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false);
      assert.equal(ticks, yieldAt, "search must await the checkpoint before processing another line");
    } finally { release(); }
    const resumed = await pending;
    assert.equal(resumed.exitCode, 0, resumed.stderr);
    assert.match(resumed.stdout, /^\/work\/input:2\n\n2 matches\n2 matched lines\n1 files contained matches\n1 files searched\n/u);
  } finally { release(); await shell.dispose(); }
});

for (const onlyMatching of [false, true]) test(`rg multiline statistics count original matches and physical lines, onlyMatching=${onlyMatching}`, async () => {
  const { shell, commands, fs } = setup();
  commands.register(rgCommand());
  await fs.writeFile("/input", Buffer.from("foo\nbar\n"));
  try {
    const result = await shell.exec(`rg --stats -U ${onlyMatching ? "-o" : ""} 'foo\\nbar' /input`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^foo\nbar\n\n1 matches\n2 matched lines\n/u);
    await fs.writeFile("/input", Buffer.from("foo foo\n"));
    const repeated = await shell.exec(`rg --stats -U ${onlyMatching ? "-o" : ""} 'foo|x\\ny' /input`);
    assert.equal(repeated.exitCode, 0, repeated.stderr);
    assert.ok(repeated.stdout.includes("\n2 matches\n1 matched lines\n"), repeated.stdout);
  } finally { await shell.dispose(); }
});
