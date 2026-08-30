import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { agentCommands, CommandRegistry, createAgentCommands, type PluginHost } from "../../../src/index.js";

const baseline60 = JSON.parse(readFileSync(new URL("./baseline60.json", import.meta.url), "utf8")) as string[];
const approved = ["seq", "nl", "rev", "unexpand", "split"];

function host(commands = new CommandRegistry()): PluginHost {
  return { commands, use() { throw new Error("Unexpected middleware"); }, registerFileSystem() { throw new Error("Unexpected filesystem"); } };
}

test("public80 registry preserves frozen60 plus the approved command families", async () => {
  assert.equal(baseline60.length, 60);
  assert.equal(new Set(baseline60).size, 60);
  assert.deepEqual(baseline60.slice(-4), ["tac", "expand", "fold", "strings"]);
  const expected = [...baseline60, ...approved, "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr", "which", "timeout", "apply_patch", "git"];
  assert.equal(expected.length, 80);
  assert.equal(new Set(expected).size, 80);
  assert.deepEqual(createAgentCommands().map(command => command.name), expected);
  const target = host();
  await agentCommands().setup(target);
  assert.deepEqual(target.commands.list().map(command => command.name), expected);
  for (const name of ["curl", "safejs", "node", "npm", "npx"]) assert.equal(target.commands.has(name), false);
});

for (const name of approved) test(`${name} aggregate collision is atomic and replacement remains explicit`, async () => {
  const original = { name, execute: () => ({ exitCode: 23 }) };
  const custom = { name: "custom", execute: () => ({ exitCode: 24 }) };
  const target = host(new CommandRegistry([original, custom]));
  const before = target.commands.list();
  assert.throws(() => agentCommands().setup(target), new RegExp(`already registered: ${name}`, "u"));
  assert.deepEqual(target.commands.list(), [original, custom]);
  await agentCommands({ replace: true }).setup(target);
  assert.equal(target.commands.list().length, 81);
  assert.equal(target.commands.get("custom"), before[1]);
  assert.notEqual(target.commands.get(name), before[0]);
});
