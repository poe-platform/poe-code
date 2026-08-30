import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { observe } from "./observer.mjs";

const root = await import("virtual-bash");
const leaf = await import("virtual-bash/commands/expr");
const id = process.argv[2];
const boundary = id.includes("direct") ? "direct" : "public";
const variant = id.startsWith("valid-") ? null : Number(id.at(-1));
const fixture = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));
const original = fixture.runtimeCases.find(row => row.id === "R21");
const args = variant === null ? ["7"] : [original, ...original.variants][variant].args;
const units = values => values.map(value => Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)));
let invocations = 0, wrapperInvocations = 0, cleanupSettled = false, outcome, error;
const identity = { rootLeafFactory: root.createExprCommand === leaf.createExprCommand, forwarded: [] };
const seenArguments = [], start = observe.begin();
function wrap(definition, directContext) {
  const execute = definition.execute;
  return { ...definition, execute(context) {
    invocations++;
    const originalSignal = context.signal;
    seenArguments.push(units(context.args));
    assert.equal(context.command, "expr");
    if (directContext) assert.equal(context, directContext);
    const tracked = new Proxy(execute, { apply(handler, receiver, argumentsList) {
      identity.forwarded.push({ handler: handler === definition.execute, receiver: receiver === definition, context: argumentsList[0] === context, signal: argumentsList[0].signal === originalSignal });
      return Reflect.apply(handler, receiver, argumentsList);
    } });
    const result = Reflect.apply(tracked, definition, [context]);
    assert.equal(context.signal, originalSignal);
    return result;
  } };
}
try {
  if (boundary === "public") {
    const shell = new root.Shell({ fs: root.createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(root.agentCommands({ expr: original.expr }));
    try {
      await shell.exec("");
      const definition = shell.commands.get("expr"); assert.ok(definition);
      shell.register(wrap(definition), { replace: true });
      shell.register({ name: "fixture-expr-invoke", execute(context) { wrapperInvocations++; return context.invoke("expr", args); } });
      outcome = await shell.exec("fixture-expr-invoke");
    } finally { await shell.dispose(); cleanupSettled = true; }
  } else {
    const stdout = [], stderr = [], cleanups = [];
    const context = {
      command: "expr", args, cwd: "/", env: { LC_ALL: "C" }, fs: root.createMemoryFileSystem(), signal: new AbortController().signal,
      stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } }, stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
      registerCleanup(cleanup) { cleanups.push(cleanup); },
    };
    Object.defineProperty(context, "stdin", { get() { assert.fail("expr accessed stdin"); } });
    try {
      const result = await wrap(root.createExprCommand(), context).execute(context);
      outcome = { ...result, stdoutBytes: Buffer.concat(stdout), stderrBytes: Buffer.concat(stderr) };
    } finally { await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()])); cleanupSettled = true; }
  }
} catch (caught) { error = { name: caught.name, message: caught.message, stack: caught.stack }; }
let workerMetrics;
try { workerMetrics = await observe.end(start); observe.restore(); } catch (caught) { error ??= { name: caught.name, message: caught.message, stack: caught.stack }; }
console.log(JSON.stringify({ id, boundary, variant, inputCodeUnits: units(args), commandCodeUnits: units(["expr"])[0], invocations, wrapperInvocations, seenArguments, identity, cleanupSettled,
  result: outcome && { exitCode: outcome.exitCode, stdoutHex: Buffer.from(outcome.stdoutBytes).toString("hex"), stderrHex: Buffer.from(outcome.stderrBytes).toString("hex"), diagnostic: Buffer.from(outcome.stderrBytes).toString("utf8") },
  error, workerMetrics, observer: observe.serializable() }));
process.exitCode = error ? 1 : 0;
