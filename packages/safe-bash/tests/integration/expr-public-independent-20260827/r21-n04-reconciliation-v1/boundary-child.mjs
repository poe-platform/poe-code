import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { observe } from "./observer.mjs";

const id = process.argv[2];
const root = await import("virtual-bash");
const leaf = await import("virtual-bash/commands/expr");
assert.equal(root.createExprCommand, leaf.createExprCommand);
const fixture = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url))).runtimeCases.find(row => row.id === "R21");
const variants = [fixture, ...fixture.variants];
const codeUnits = args => args.map(argument => typeof argument === "string" ? Array.from({ length: argument.length }, (_, index) => argument.charCodeAt(index)) : { type: typeof argument, value: argument });
const observation = id.startsWith("observe-");
const boundary = id.includes("-direct") ? "direct" : "public";
const variant = observation ? Number(id.at(-1)) : undefined;
const args = observation ? variants[variant].args : id === "control-nonstring-public" ? [7] : ["7"];
const name = id === "control-nul-command-public" ? "expr\0" : "expr";
let invocations = 0, wrapperInvocations = 0, cleanupSettled = false, outcome, error;
const seenArguments = [], start = observe.begin();
function wrap(definition) {
  return { ...definition, execute(context) {
    invocations++; seenArguments.push(codeUnits(context.args));
    return definition.execute(context);
  } };
}
try {
  if (boundary === "public") {
    const shell = new root.Shell({ fs: root.createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(root.agentCommands({ expr: fixture.expr }));
    try {
      await shell.exec("");
      const definition = shell.commands.get("expr"); assert.ok(definition);
      shell.register(wrap(definition), { replace: true });
      shell.register({ name: "fixture-expr-invoke", execute(context) { wrapperInvocations++; return context.invoke(name, args); } });
      outcome = await shell.exec("fixture-expr-invoke");
    } finally { await shell.dispose(); cleanupSettled = true; }
  } else {
    const stdout = [], stderr = [], cleanups = [];
    const context = {
      command: "expr", args, cwd: "/", env: { LC_ALL: "C" }, fs: root.createMemoryFileSystem(), signal: new AbortController().signal,
      stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
      stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
      registerCleanup(cleanup) { cleanups.push(cleanup); },
    };
    Object.defineProperty(context, "stdin", { get() { assert.fail("expr accessed stdin"); } });
    try {
      const result = await wrap(root.createExprCommand()).execute(context);
      outcome = { ...result, stdoutBytes: Buffer.concat(stdout), stderrBytes: Buffer.concat(stderr) };
    } finally { await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()])); cleanupSettled = true; }
  }
} catch (caught) { error = { name: caught.name, message: caught.message, stack: caught.stack }; }
let workerMetrics;
try { workerMetrics = await observe.end(start); observe.restore(); } catch (caught) { error ??= { name: caught.name, message: caught.message, stack: caught.stack }; }
const record = { id, observation, boundary, variant, inputCodeUnits: codeUnits(args), commandCodeUnits: codeUnits([name])[0], invocations, wrapperInvocations, seenArguments, cleanupSettled,
  result: outcome && { exitCode: outcome.exitCode, stdoutHex: Buffer.from(outcome.stdoutBytes).toString("hex"), stderrHex: Buffer.from(outcome.stderrBytes).toString("hex"), diagnostic: Buffer.from(outcome.stderrBytes).toString("utf8") },
  error, workerMetrics, observer: observe.serializable(), status: error ? "failure" : observation ? "observation-not-rescored" : "control-result" };
console.log(JSON.stringify(record));
process.exitCode = error ? 1 : 0;
