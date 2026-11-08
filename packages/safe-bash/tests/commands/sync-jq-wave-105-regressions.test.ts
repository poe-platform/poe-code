import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const filters = [
  ['{"tags":[]}', 'select(.tags == [])', '{"tags":[]}'],
  ['{"tags":[]}', 'select(.tags != [])', ''],
  ['{"meta":{}}', 'select(.meta == {})', '{"meta":{}}'],
  ['{"meta":{"b":2,"a":1}}', 'select(.meta == {"a":1,"b":2})', '{"meta":{"b":2,"a":1}}'],
  ['{"a":"ok","b":"WRONG"}', '.a // "x, .b // 1"', 'ok'],
  ['{"a":"ok","b":"WRONG"}', '. // "x | .b // 1"', '{"a":"ok","b":"WRONG"}'],
  ['{"a":null,"b":"ok"}', '(.a) // (.b)', 'ok'],
  ['{"a":"ok","b":"wrong"}', '(.a) // (.b)', 'ok'],
  ['{"a":null}', '.a // "x, y | z // q"', 'x, y | z // q'],
  ['{"a":false}', '.a // [1,2]', '[1,2]'],
  ['{"a":"ok","b":"WRONG"}', '[.a // "x, .b // 1"]', '["ok"]'],
  ['{"a":"ok","b":"WRONG"}', '[.a // "x | .b // 1"]', '["ok"]'],
] as const;
for (const [input, filter, expected] of filters) {
  for (const loop of [false, true]) test(`jq ${filter}, loop=${loop}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStructuredCommands()]) });
    try {
      const assignment = `out=$(printf '%s' "$s" | jq -rc '${filter}')`;
      const result = await shell.exec(`s='${input}'; ${loop ? `for ((i=0;i<2;i++)); do ${assignment}; done` : assignment}; printf '%s' "$out"`);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
for (const read of ['jq .a /data.json', 'jq .a < /data.json', 'cat /data.json | jq .a']) {
  for (const write of ['echo bad > /data.json', 'echo bad >> /data.json', 'echo bad >| /data.json', 'printf bad | tee /data.json > /dev/null']) test(`mutable jq input: ${read}, ${write}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStructuredCommands()]) });
    try {
      const result = await shell.exec(`echo '{"a":1}' > /data.json; out=""; for ((i=0;i<2;i++)); do out+=$(${read}); ${write}; done; printf 'out=%s' "$out"`);
      assert.equal(result.stdout, write.includes('>>') ? 'out=11' : 'out=1');
      assert.match(result.stderr, /jq:.*parse/i);
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

for (const loop of ['for i in 1 2', 'i=0; while ((i++<2))']) {
  for (const write of ['if true; then echo bad > /data.json; fi', '{ echo bad; } > /data.json', 'ignored=$(echo bad > /data.json)']) test(`nested file mutation: ${loop}, ${write}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStructuredCommands()]) });
    try {
      const result = await shell.exec(`echo '{"a":1}' > /data.json; out=""; ${loop}; do out+=$(jq .a /data.json); ${write}; done; printf '%s' "$out"`);
      assert.equal(result.stdout, "1");
      assert.match(result.stderr, /jq:.*parse/i);
    } finally { await shell.dispose(); }
  });
}
test("jq validates unused fallback syntax", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createStructuredCommands()]) });
  try {
    const result = await shell.exec(`s='{"a":"ok"}'; out=$(printf '%s' "$s" | jq -r '.a // "unterminated'); status=$?; printf '%s:%s' "$out" "$status"`);
    assert.equal(result.stdout, ":3");
    assert.match(result.stderr, /jq:/);
  } finally { await shell.dispose(); }
});
