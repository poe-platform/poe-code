import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createXmllintCommand } from "./index.js";

const input = '<catalog xml:lang="en-US"><item id="a" xml:id="first"><n>1</n><n>2</n><s>AB</s></item><item id="b" xml:lang="fr"><n>2</n><s>xy</s></item><item id="c"><n>03</n><n>3</n></item></catalog>';
for (const [query, expected] of [
  ['count(//@xml:*)', '3'],
  ['count(//attribute::xml:*)', '3'],
  ['count(//item[@xml:*])', '2'],
  ['//@xml:*', ' xml:lang="en-US"\n xml:id="first"\n xml:lang="fr"'],
] as const) test(`predefined XML namespace wildcard: ${query}`, async () => {
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
