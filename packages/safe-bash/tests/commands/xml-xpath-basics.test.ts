import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem } from "../../src/index.js";
import { xmlCommands } from "../../src/commands/xml/index.js";
const xml = '<root><item id="1"><name>first</name></item><item><name>second</name></item></root>';
const first = '<item id="1"><name>first</name></item>\n';
const second = '<item><name>second</name></item>\n';
for (const [query, expected] of [
  ['//item[@id]', first], ['//item[last()]', second], ['//item[position()=2]', second],
  ["//item[name='second']", second], ["//name[text()='first']", '<name>first</name>\n'],
  ["//name[.='second']", '<name>second</name>\n'],
  ['//item[2] | //item[@id] | //item[1]', first + second],
  ['//item/./name/..', first + second], ['root/item[1]', first],
  ['count(//item[1] | //item[2])', '2\n'],
  ['//item[@id][last()]', first],
  ['count ( //item )', '2\n'],
  ["//item[name='first']/name/.", '<name>first</name>\n'],
] as const) test(`XPath basics: ${query}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(xmlCommands());
  try {
    const result = await shell.exec('xmllint --xpath "' + query + '" -', { stdin: Buffer.from(xml) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});
for (const args of ['-', '/input', '-- /input']) test(`flagless xmllint ${args}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile('/input', Buffer.from(xml));
  const shell = new Shell({ fs }).use(xmlCommands());
  try {
    const result = await shell.exec('xmllint ' + args, { stdin: Buffer.from(xml) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '<?xml version="1.0"?>\n' + xml + '\n');
  } finally { await shell.dispose(); }
});

for (const query of ['//item |', '//item[]', '//item[last(1)]', '//item[@id=]', '//item[position()=0]']) {
  test(`XPath rejects malformed query: ${query}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(xmlCommands());
    try {
      const result = await shell.exec('xmllint --xpath "' + query + '" -', { stdin: Buffer.from(xml) });
      assert.equal(result.exitCode, 10);
      assert.equal(result.stdout, "");
    } finally { await shell.dispose(); }
  });
}
test("XPath positions are per parent and equality checks every child/text node", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(xmlCommands());
  try {
    const input = '<r><g><i/><i id="a"/></g><g><i id="b"/></g><v><n>no</n><n>yes</n>no<b/>yes</v></r>';
    for (const [query, expected] of [
      ['//i[last()]', '<i id="a"/>\n<i id="b"/>\n'],
      ["//v[n='yes'][text()='yes']", '<v><n>no</n><n>yes</n>no<b/>yes</v>\n'],
    ]) {
      const result = await shell.exec('xmllint --xpath "' + query + '" -', { stdin: Buffer.from(input) });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    }
  } finally { await shell.dispose(); }
});
