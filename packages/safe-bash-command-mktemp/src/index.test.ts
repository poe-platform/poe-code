import assert from "node:assert/strict";
import test from "node:test";
import { createMktempCommand, createMktempCommands, mktempCommands } from "./index.js";
test("mktemp exports its command and plugin", () => {
  assert.equal(createMktempCommand().name, "mktemp");
  assert.equal(createMktempCommands().length, 1);
  assert.equal(mktempCommands().name, "mktemp-commands");
});
