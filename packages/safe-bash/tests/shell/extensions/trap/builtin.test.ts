import assert from "node:assert/strict";
import test from "node:test";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { trapExtension } from "../../../../src/shell/extensions/trap/index.js";
import { nativeOptions, runNative } from "./oracle.js";

const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'";
const cases: readonly [string, readonly (readonly string[])[]][] = [
  ["empty listing", [[]]],
  ["set and list", [["printf value", "EXIT"], ["-p"]]],
  ["quoted listing", [["printf 'a b'", "EXIT"], ["-p", "EXIT"]]],
  ["ignored signal", [["", "INT"], ["-p", "SIGINT"]]],
  ["case and numeric aliases", [[":", "sigint"], ["-p", "2"], ["-", "2"], ["-p", "INT"]]],
  ["single signal reset", [[":", "EXIT"], ["EXIT"], ["-p"]]],
  ["numeric reset", [[":", "EXIT"], ["0"], ["-p"]]],
  ["numeric operand resets multiple signals", [[":", "INT", "TERM"], ["2", "15"], ["-p"]]],
  ["numeric first operand is not an action", [[":", "EXIT"], ["0", "EXIT"], ["-p"]]],
  ["signed action is not numeric reset", [[":", "INT", "TERM"], ["+2", "TERM"], ["-p"], ["-", "INT", "TERM"]]],
  ["multiple signals", [[":", "EXIT", "USR1"], ["-p"], ["-", "EXIT", "USR1"], ["-p"]]],
  ["terminator", [["--", "printf value", "EXIT"], ["--"]]],
];

for (const [name, operations] of cases) test(`native trap builtin: ${name}`, nativeOptions(), async () => {
  const source = operations.map(args => "trap " + args.map(quote).join(" ")).join("; ") + "; trap - EXIT INT USR1";
  const captured = runNative(source);
  const native = { ...captured, stdout: captured.stdout.toString(), stderr: captured.stderr.toString() };
  assert.ifError(native.error);
  assert.equal(native.status, 0, native.stderr);
  const instance = trapExtension().create();
  const builtin = instance.builtins.find(entry => entry.name === "trap");
  assert.ok(builtin);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  for (const args of operations) {
    const context: ShellExtensionContext = {
      command: "trap", args, argumentValues: args, status: 0, functionDepth: 0, sourceDepth: 0,
      stdin: (async function* () {})(), signal: new AbortController().signal, scope: {},
      stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
      get bindings(): ShellExtensionContext["bindings"] { throw new Error("Listing must not access bindings"); },
      get input(): ShellExtensionContext["input"] { throw new Error("Listing must not access input"); },
      async evaluate() { throw new Error("Listing must not evaluate actions"); },
      variable() { return undefined; }, accountSource() {}, registerCleanup() {},
      async diagnostic(message) { stderr.push(new TextEncoder().encode(message + "\n")); },
    };
    assert.equal(await builtin.execute(context), 0);
  }
  assert.equal(Buffer.concat(stdout).toString(), native.stdout);
  assert.equal(Buffer.concat(stderr).toString(), "");
});
