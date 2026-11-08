import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createXmllintCommand } from "./index.js";

const input = '<catalog xml:lang="en-US"><item id="a" xml:id="first"><n>1</n><n>2</n><s>AB</s></item><item id="b" xml:lang="fr"><n>2</n><s>xy</s></item><item id="c"><n>03</n><n>3</n></item><ref>first missing</ref><ref>first</ref></catalog>';
for (const [query, expected] of [
  ['count(id("first"))', '1'],
  ['count(//item[id("first")])', '3'],
  ['count(id("a"))', '0'],
  ['count(id("missing"))', '0'],
  ['count(id("first first\tmissing\nfirst"))', '1'],
  ['count(id(//ref))', '1'],
  ['count(id(""))', '0'],
  ['name(id("first"))', 'item'],
  ['id("first")', '<item id="a" xml:id="first"><n>1</n><n>2</n><s>AB</s></item>'],
] as const) test(`document ID lookup: ${query}`, async () => {
  const { result, output, errors } = await run(query, input);
  assert.equal(result.exitCode, 0, errors);
  assert.equal(output, expected + '\n');
});

async function run(query: string, input: string) {
  let output = '', errors = '';
  const carrier = createCommandArguments(['--xpath', query, '-']);
  const result = await createXmllintCommand().execute({
    args: carrier.args, arguments: carrier, command: 'xmllint', cwd: '/', env: {},
    signal: new AbortController().signal, stdin: toByteSource(input), fs: createMemoryFileSystem(),
    stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors += new TextDecoder().decode(bytes); } },
  } as unknown as CommandContext);
  return { result, output, errors };
}

for (const input of [
  '<!DOCTYPE r [<!ATTLIST x id ID #IMPLIED>]><r><x id="first"/></r>',
  '<!DOCTYPE r SYSTEM "https://example.invalid/document.dtd"><r xml:id="first"/>',
]) test('ID lookup does not enable DTDs', async () => {
  const { result, output } = await run('count(id("first"))', input);
  assert.notEqual(result.exitCode, 0);
  assert.equal(output, '');
});

test('empty ID selection preserves the empty-set exit status', async () => {
  const { result, output } = await run('id("missing")', input);
  assert.equal(result.exitCode, 11);
  assert.equal(output, '');
});
