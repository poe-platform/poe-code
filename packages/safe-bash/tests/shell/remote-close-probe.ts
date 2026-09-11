import assert from "node:assert/strict";
import { createOutputOperation, pipeBytes, writeText } from "../../src/contracts/index.js";
import type { ByteSource } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

const scenario = process.argv[2]!;
const { shell, fs, commands } = setup({ limits: { pipeHighWaterMark: 1 } });
Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false } });
const keepAlive = setInterval(() => {}, 1000);
const controller = new AbortController();
const callerReason = new Error("external caller reason");
const unexpected = new Error("genuine producer rejection");
const consumerFailure = new Error("genuine consumer rejection");
const internalErrors: unknown[] = [];
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
process.on("unhandledRejection", onUnhandled);
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
let active = 0;
let returned = 0;
let finished = 0;
let pending = 0;
let observed: AbortSignal | undefined;
let upstreamContext: AbortSignal | undefined;
let invokedContext: AbortSignal | undefined;
let releaseLate: (() => void) | undefined;
let consumerFinished!: () => void;
const consumed = new Promise<void>(resolve => { consumerFinished = resolve; });
let producerFinished!: () => void;
const produced = new Promise<void>(resolve => { producerFinished = resolve; });

shell.use(async (context, next) => {
  if (context.command === "forward") upstreamContext = context.signal;
  if (context.command === "stream" && scenario === "nested-invoke") {
    invokedContext = context.signal;
    assert.equal(context.stdinIsDefault, true);
  }
  return await next();
});

function pendingRead(signal: AbortSignal): Promise<never> {
  signal.throwIfAborted();
  active++;
  pending++;
  return new Promise<never>((_resolve, reject) => {
    const abort = () => {
      active--;
      if (scenario === "late-read-rejection") {
        releaseLate = () => reject(new Error("late read rejection"));
        setImmediate(releaseLate);
      }
      else reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

fs.readStream = (_path, options = {}): ByteSource => {
  const signal = options.signal!;
  observed = signal;
  return (async function* () {
    try {
      yield new TextEncoder().encode("first\n");
      if (scenario.startsWith("completed-")) {
        if (scenario === "completed-rejection") throw unexpected;
        return;
      }
      await pendingRead(signal);
    } finally { returned++; }
  })();
};

commands.register({ name: "stream", async execute(context) {
  const { stdout, signal, fs } = context;
  let operation: ReturnType<typeof createOutputOperation> | undefined;
  try {
    if (scenario === "delayed-no-write" || scenario === "zero-byte-no-write") {
      if (scenario === "zero-byte-no-write") await stdout.write(new Uint8Array());
      await consumed;
      await turn();
      assert.equal(signal.aborted, false);
      await fs.writeFile("/after", new Uint8Array([65]), { signal });
      return { exitCode: 7 };
    }
    operation = createOutputOperation(context, stdout);
    if (scenario === "transport" || scenario === "caller-abort" || scenario === "budget-abort") {
      observed = operation.signal;
      await writeText(operation.output, "first\n");
      await pendingRead(operation.signal);
    } else {
      const source = await operation.acquire(signal => fs.readStream!("/input", { signal })[Symbol.asyncIterator](), async source => { await source.return?.(); });
      await pipeBytes({ [Symbol.asyncIterator]: () => source }, operation.output, operation.signal);
    }
    return { exitCode: scenario === "completed-failure" ? 7 : 0 };
  } finally { await operation?.close(); finished++; producerFinished(); }
} });
commands.register({ name: "pass", async execute(context) {
  const operation = createOutputOperation(context, context.stdout);
  try { await pipeBytes(context.stdin, operation.output, operation.signal); return { exitCode: 0 }; }
  finally { await operation.close(); }
} }, { replace: true });
commands.register({ name: "forward", async execute(context) {
  assert.equal(context.stdinIsDefault, true);
  return await context.invoke!("stream", []);
} });
commands.register({ name: "first", async execute({ stdin, stdout, signal }) {
  for await (const chunk of stdin) {
    await stdout.write(chunk);
    if (scenario.startsWith("completed-")) {
      await produced;
      assert.equal(returned, 1);
      assert.equal(finished, 1);
      assert.equal(pending, 0);
    }
    break;
  }
  if (scenario === "caller-abort") {
    controller.abort(callerReason);
    signal.throwIfAborted();
  }
  consumerFinished();
  if (scenario === "consumer-rejection") throw consumerFailure;
  return { exitCode: scenario === "middle-status" || scenario === "consumer-status" ? 7 : 0 };
} });
commands.register({ name: "no-read", execute() { consumerFinished(); return { exitCode: 0 }; } });

try {
  await fs.writeFile("/input", new Uint8Array([65]));
  let source = "stream | first";
  if (scenario === "middle") source = "stream | pass | first";
  if (scenario === "middle-status") source = "stream | first | pass";
  if (scenario === "nested-invoke") source = "forward | first";
  if (scenario === "redirect") source = "pass < /input | first";
  if (scenario === "group") source = "{ stream; say forbidden; } | first";
  if (scenario === "delayed-no-write" || scenario === "zero-byte-no-write" || scenario === "closed-before-write") source = "stream | no-read";
  const pipefail = !["transport", "caller-abort", "budget-abort"].includes(scenario);
  if (pipefail) source = `set -o pipefail; ${source}`;
  const execution = shell.exec(`${source}; status $?`, { signal: controller.signal, onInternalError(error) { internalErrors.push(error); },
    ...(scenario === "budget-abort" ? { limits: { maxOutputBytes: 6 } } : {}),
  });
  if (scenario === "caller-abort") await assert.rejects(execution, error => error === callerReason);
  else if (scenario === "budget-abort") await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  else {
    const result = await execution;
    const expected = scenario === "completed-rejection" || scenario === "consumer-rejection" ? 1
      : ["completed-failure", "delayed-no-write", "zero-byte-no-write", "middle-status", "consumer-status"].includes(scenario) ? 7
      : scenario === "transport" || scenario === "completed-success" ? 0 : 141;
    assert.equal(result.exitCode, expected);
    assert.equal(result.stdout, ["delayed-no-write", "zero-byte-no-write", "closed-before-write"].includes(scenario) ? "" : "first\n");
    assert.equal(result.stderr, scenario === "completed-rejection" || scenario === "consumer-rejection" ? "shell: line 1: internal error\n" : "");
    if (scenario === "completed-rejection" || scenario === "consumer-rejection") {
      assert.equal(internalErrors.length, 1);
      assert.equal(internalErrors[0], scenario === "completed-rejection" ? unexpected : consumerFailure);
    } else assert.deepEqual(internalErrors, []);
    assert.equal(controller.signal.aborted, false);
  }
  releaseLate?.();
  await turn();
  await turn();
  assert.equal(active, 0);
  if (scenario.startsWith("completed-")) {
    assert.ok(observed);
    assert.equal(pending, 0);
  } else if (!["delayed-no-write", "zero-byte-no-write"].includes(scenario)) {
    assert.equal(observed?.aborted, true);
    if (scenario === "caller-abort") assert.equal(observed?.reason, callerReason);
    else if (scenario === "budget-abort") assert.ok(observed?.reason instanceof ShellLimitError);
    else assert.equal((observed?.reason as { code: string }).code, scenario === "redirect" ? "EBADF" : "EPIPE");
  }
  if (!["transport", "caller-abort", "budget-abort", "delayed-no-write", "zero-byte-no-write"].includes(scenario)) assert.equal(returned, 1);
  if (scenario !== "redirect") assert.equal(finished, 1);
  if (["pipefail", "middle", "middle-status", "nested-invoke", "redirect", "iterator-return", "late-read-rejection", "transport", "group", "consumer-rejection", "consumer-status"].includes(scenario)) assert.equal(pending, 1);
  if (scenario === "nested-invoke") {
    assert.equal(invokedContext, upstreamContext);
    assert.notEqual(observed, invokedContext);
    assert.equal(invokedContext?.aborted, false);
  }
  if (scenario === "delayed-no-write" || scenario === "zero-byte-no-write") assert.deepEqual(await fs.readFile("/after"), new Uint8Array([65]));
  assert.equal((await shell.exec("say alive")).stdout, "alive\n");
  assert.deepEqual(unhandled, []);
} finally {
  controller.abort(callerReason);
  releaseLate?.();
  await shell.dispose();
  process.removeListener("unhandledRejection", onUnhandled);
  clearInterval(keepAlive);
}
console.log(`${scenario}: passed`);
