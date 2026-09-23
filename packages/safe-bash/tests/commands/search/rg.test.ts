import assert from "node:assert/strict";
import test from "node:test";
import { jsonEvents, virtual } from "./helpers.js";
import { setup } from "../../shell/helpers.js";
import { rgCommand } from "../../../src/commands/search/rg.js";

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
