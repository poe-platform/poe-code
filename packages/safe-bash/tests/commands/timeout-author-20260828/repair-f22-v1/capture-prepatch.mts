import { performance } from "node:perf_hooks";
import { CommandRegistry, Shell, createMemoryFileSystem } from "../../../../src/index.js";
import { createTimeoutCommand } from "../../../../src/commands/timeout/index.js";
import { captureContext, turn } from "../fixtures.js";

const activeTimeouts = (): number => process.getActiveResourcesInfo().filter(resource => resource === "Timeout").length;
const encodeError = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof Error)) return { type: typeof error, value: String(error) };
  return {
    name: error.name,
    message: error.message,
    code: "code" in error ? error.code : null,
    stack: error.stack,
  };
};
const encodeSettlement = (result: PromiseSettledResult<void>): Record<string, unknown> => result.status === "fulfilled"
  ? { status: result.status }
  : { status: result.status, reason: encodeError(result.reason) };

const resourcesBefore = activeTimeouts();
let directChildCalls = 0;
const direct = captureContext(["1", "child"], {
  invoke: async () => {
    directChildCalls++;
    return { exitCode: 7 };
  },
});
const directResult = await createTimeoutCommand().execute(direct.context);
const directCleanup = await Promise.allSettled(direct.cleanups.map(cleanup => cleanup()));

let shellChildCalls = 0;
const commands = new CommandRegistry([createTimeoutCommand(), {
  name: "child",
  execute: () => {
    shellChildCalls++;
    return { exitCode: 7 };
  },
}]);
const shell = new Shell({ fs: createMemoryFileSystem(), commands });
let shellResult;
try {
  shellResult = await shell.exec("timeout 1 child");
} finally {
  await shell.dispose();
}
await turn();

const capturedNow = performance.now;
let directReceiverDiagnostic: Record<string, unknown> | null = null;
try {
  Reflect.apply(capturedNow, undefined, []);
} catch (error) {
  directReceiverDiagnostic = encodeError(error);
}

process.stdout.write(`${JSON.stringify({
  schema: "timeout-author-f22-fresh-prepatch-capture/1",
  classification: "fresh post-candidate diagnosis and baseline; not recovered independent-run data",
  node: process.version,
  candidate: "9ed9a0f14d12758713a8dc42be1ff75f0c87a36f",
  directProduct: {
    result: directResult,
    childCalls: directChildCalls,
    cleanupRegistrations: direct.cleanups.length,
    cleanupSettlement: directCleanup.map(encodeSettlement),
    stdoutUtf8: direct.stdout(),
    stdoutBase64: Buffer.from(direct.stdout()).toString("base64"),
    stderrUtf8: direct.stderr(),
    stderrBase64: Buffer.from(direct.stderr()).toString("base64"),
    underlyingCaughtExceptionRetained: false,
  },
  actualShellProduct: {
    result: { exitCode: shellResult.exitCode },
    childCalls: shellChildCalls,
    stdoutUtf8: shellResult.stdout,
    stdoutBase64: Buffer.from(shellResult.stdoutBytes).toString("base64"),
    stderrUtf8: shellResult.stderr,
    stderrBase64: Buffer.from(shellResult.stderrBytes).toString("base64"),
    disposed: true,
    underlyingCaughtExceptionRetained: false,
  },
  directReceiverDiagnostic: {
    classification: "separate minimal direct Node receiver diagnostic; not original or product stderr",
    error: directReceiverDiagnostic,
  },
  resources: {
    timeoutBefore: resourcesBefore,
    timeoutAfter: activeTimeouts(),
  },
}, null, 2)}\n`);
