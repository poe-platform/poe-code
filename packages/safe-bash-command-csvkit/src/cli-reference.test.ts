import assert from "node:assert/strict";
import { test } from "vitest";
import observations from "../../../docs/csvkit/oracle-3.14.2.json" with { type: "json" };
import grammar from "../../../docs/csvkit/parser-contract-audit-20260917.json" with { type: "json" };
import { commands } from "./commands.js";
import { parseArguments } from "./cli/parser.js";

const limits = { maxArguments: 100, maxArgumentBytes: 10000 };
const bytes = (args: readonly string[]) => args.map(arg => new TextEncoder().encode(arg));

for (const item of observations) {
  test(`frozen CPython 3.14.2 CLI channels: ${item.command} ${item.argv.join(" ")}`, async () => {
    assert.deepEqual(await parseArguments(item.command, bytes(item.argv), { limits }), {
      kind: "exit", status: item.status, stdout: item.stdout, stderr: item.stderr
    });
  });
}

test("every command action and usage matches the frozen argparse descriptor", () => {
  const reference = grammar.profiles.find(profile => profile.runtime.startsWith("3.14.2"))!;
  assert.deepEqual(commands.map(command => command.name), reference.commands.map(command => command.name));
  for (const command of commands) {
    const original = reference.commands.find(item => item.name === command.name)!;
    // Capture used PYTHONIOENCODING=utf-8; descriptors defer that injected default.
    const actions = command.actions.map(action => ({ ...action,
      type: action.type === "builtins.int" ? "<class 'int'>" : action.type === "builtins.str" ? "<class 'str'>" : action.type,
      default: action.dest === "encoding" && action.default === "utf-8-sig" ? grammar.environment.PYTHONIOENCODING : action.default
    }));
    assert.deepEqual(actions, original.actions, command.name);
    assert.equal(command.usage, original.usage, command.name);
    assert.deepEqual(command.defaults, original.parserDefaults, command.name);
  }
});
