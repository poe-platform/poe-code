import type { RunResult } from "../run.js";
import { dump } from "../snapshot/dump.js";

type SignalName = "SIGINT" | "SIGTERM";

type SignalProcess = Pick<NodeJS.Process, "exit" | "off" | "once">;

export function attachSignalDumpHandler(
  result: PromiseLike<RunResult>,
  options: {
    dumpResult?: (result: PromiseLike<RunResult>) => Promise<string>;
    onError?: (error: unknown, signal: SignalName) => Promise<void> | void;
    onSnapshot?: (snapshot: string, signal: SignalName) => Promise<void> | void;
    process?: SignalProcess;
  } = {}
): () => void {
  const dumpResult = options.dumpResult ?? dump;
  const signalProcess = options.process ?? process;
  let shuttingDown = false;

  const onSigint = () => {
    handleSignal("SIGINT");
  };
  const onSigterm = () => {
    handleSignal("SIGTERM");
  };

  signalProcess.once("SIGINT", onSigint);
  signalProcess.once("SIGTERM", onSigterm);

  return cleanup;

  function cleanup(): void {
    signalProcess.off("SIGINT", onSigint);
    signalProcess.off("SIGTERM", onSigterm);
  }

  function handleSignal(signal: SignalName): void {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    cleanup();

    void (async () => {
      try {
        const snapshot = await dumpResult(result);
        await options.onSnapshot?.(snapshot, signal);
        signalProcess.exit(0);
      } catch (error) {
        await options.onError?.(error, signal);
        signalProcess.exit(1);
      }
    })();
  }
}
