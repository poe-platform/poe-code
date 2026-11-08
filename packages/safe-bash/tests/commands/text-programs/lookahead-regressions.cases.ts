import assert from "node:assert/strict";
import test from "node:test";
import { createTextProgramCommands } from "../../../src/commands/text-programs/index.js";
import { makeFileSystem } from "./helpers.js";

test("sed prints and quits before requesting a second producer chunk", async () => {
  let pulls = 0;
  let returned = false;
  const source = (async function* () {
    try {
      pulls++; yield Buffer.from("first\n");
      pulls++; throw new Error("unneeded producer failure");
    } finally { returned = true; }
  })();
  const stdout: Uint8Array[] = [];
  const result = await createTextProgramCommands().find(command => command.name === "sed")!.execute({
    command: "sed", args: ["1q"], cwd: "/work", env: {}, fs: await makeFileSystem(), signal: new AbortController().signal,
    stdin: source, stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write() {} },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(stdout).toString(), "first\n");
  assert.equal(pulls, 1);
  assert.equal(returned, true);
});
