import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createXmllintCommand } from "./index.js";

// Expected bytes checked against native libxml2 xmllint --c14n11.
for (const [input, expected] of [
  ['<r a="1" Z="2"/>', '<r Z="2" a="1"></r>'],
  ['<r>café</r>', '<r>café</r>'],
  ['<r xmlns="urn:r" xmlns:p="urn:p" xml:id="root" xml:base="../a/"><c xml:base="../b/"/><d xmlns=""/></r>', '<r xmlns="urn:r" xmlns:p="urn:p" xml:base="../a/" xml:id="root"><c xml:base="../b/"></c><d xmlns=""></d></r>'],
  ['<?before x?><r><!--hi--><![CDATA[a&b]]></r><?after y?>', '<?before x?>\n<r><!--hi-->a&amp;b</r>\n<?after y?>']
] as const) {
  test(`xmllint canonicalizes whole documents with --c14n11: ${input}`, async () => {
    let output = "", errors = "";
    const context: CommandContext = {
      ...createCommandArguments(["--c14n11"]), command: "xmllint", cwd: "/", env: {},
      fs: createMemoryFileSystem(), signal: new AbortController().signal, stdin: toByteSource(input),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } },
    };
    assert.equal((await createXmllintCommand().execute(context)).exitCode, 0, errors);
    assert.equal(output, expected);
    assert.equal(errors, "");
  });
}
