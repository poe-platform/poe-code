import assert from "node:assert/strict";
import test from "node:test";
import { createMoreCommand, createMoreCommands, moreCommands } from "./index.js";

test("more has an independent command and plugin contract", () => {
  assert.equal(createMoreCommand().name, "more");
  assert.deepEqual(createMoreCommands().map(command => command.name), ["more"]);
  assert.equal(moreCommands().name, "more-commands");
  assert.throws(() => createMoreCommand({ limits: { maxInputBytes: 0 } }), RangeError);
  assert.doesNotThrow(() => createMoreCommand({ limits: { maxInputBytes: Infinity } }));
});

import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";

for (const maximum of [undefined, Infinity, 3]) {
  test(`more preserves bytes and enforces the opt-in input quota ${maximum}`, async () => {
    const input = new Uint8Array([0, 255, 128, 10]);
    const output: number[] = [];
    let diagnostic = "";
    const result = await createMoreCommand(maximum === undefined ? {} : { limits: { maxInputBytes: maximum } }).execute({
      command: "more", args: createCommandArguments([]).args, cwd: "/", env: {},
      fs: createMemoryFileSystem(), signal: new AbortController().signal,
      stdin: (async function* () { yield input; })(),
      stdout: { async write(bytes) { output.push(...bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } },
    });
    assert.equal(result.exitCode, maximum === 3 ? 1 : 0, diagnostic);
    assert.deepEqual(output, maximum === 3 ? [] : [...input]);
    if (maximum === 3) assert.match(diagnostic, /more: input exceeds maximum size of 3 bytes/);
  });
}
