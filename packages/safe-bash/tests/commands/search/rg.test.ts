import assert from "node:assert/strict";
import test from "node:test";
import { jsonEvents, virtual } from "./helpers.js";

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
