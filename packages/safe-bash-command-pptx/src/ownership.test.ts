import assert from "node:assert/strict";
import test from "node:test";
import { createPptxCommandEngine } from "./command-engine.js";

test("the command owner executes discovery without document IO", async () => {
  const result = await createPptxCommandEngine().execute({
    args: [new TextEncoder().encode("--help")],
    signal: new AbortController().signal,
    async readInput() { throw new Error("help must not read a document"); }
  });
  assert.equal(result.exitCode, 0);
  assert.match(new TextDecoder().decode(result.stdout), /pptx/);
  assert.equal(result.stderr.length, 0);
});
