import { Readable, Writable } from "node:stream";
import type { MockRunBehavior, RunHandle, Runner, RunSpec } from "../types.js";

export function createMockRunner(behaviors: MockRunBehavior[]): Runner {
  const remaining = [...behaviors];

  return {
    name: "mock",
    exec(spec) {
      const behavior = remaining.shift();
      if (behavior === undefined) {
        throw new Error("No mock run behaviors left");
      }

      return createRunHandle(spec, behavior);
    }
  };
}

export function createMockRunnerByCommand(
  behaviorsByCommand: Record<string, MockRunBehavior>
): Runner {
  return {
    name: "mock",
    exec(spec) {
      const behavior = Object.prototype.hasOwnProperty.call(behaviorsByCommand, spec.command)
        ? behaviorsByCommand[spec.command]
        : undefined;
      if (behavior === undefined) {
        throw new Error(
          `No mock run behavior found for command "${spec.command}"`
        );
      }

      return createRunHandle(spec, behavior);
    }
  };
}

function createRunHandle(spec: RunSpec, behavior: MockRunBehavior): RunHandle {
  const stdoutMode = spec.stdout ?? "pipe";
  const stderrMode = spec.stderr ?? "pipe";
  const stdinMode = spec.stdin ?? "ignore";
  const interval = behavior.stdoutInterval ?? 10;

  if (behavior.exitAfterMs !== undefined && (!Number.isFinite(behavior.exitAfterMs) || behavior.exitAfterMs < 0)) {
    throw new Error("Mock run exitAfterMs must be a finite non-negative number.");
  }

  const stdoutController =
    stdoutMode === "pipe" && behavior.stdout !== undefined
      ? createReadableStream(behavior.stdout, interval)
      : null;
  const stderrController =
    stderrMode === "pipe" && behavior.stderr !== undefined
      ? createReadableStream(behavior.stderr, interval)
      : null;
  const outputDone = Promise.all([
    ...(stdoutController === null ? [] : [stdoutController.done]),
    ...(stderrController === null ? [] : [stderrController.done])
  ]);

  let resolveResult: ((value: { exitCode: number }) => void) | null = null;
  const result = new Promise<{ exitCode: number }>((resolve) => {
    resolveResult = resolve;
  });

  let finished = false;
  const complete = () => {
    if (finished || resolveResult === null) {
      return;
    }

    finished = true;
    resolveResult({ exitCode: behavior.exitCode });
  };

  const stopStreams = () => {
    stdoutController?.stop();
    stderrController?.stop();
  };

  const exitAfterMs = behavior.exitAfterMs;
  const exitTimer =
    exitAfterMs === undefined
      ? undefined
      : exitAfterMs > 0
        ? setTimeout(complete, exitAfterMs)
        : undefined;

  if (exitAfterMs === undefined) {
    void outputDone.then(complete);
  } else if (exitAfterMs === 0) {
    queueMicrotask(complete);
  }

  return {
    pid: behavior.pid ?? null,
    stdout: stdoutController?.stream ?? null,
    stderr: stderrController?.stream ?? null,
    stdin: stdinMode === "pipe" ? createWritableStream() : null,
    result,
    kill() {
      if (exitTimer !== undefined) {
        clearTimeout(exitTimer);
      }
      stopStreams();
      complete();
    }
  };
}

function createReadableStream(lines: string[], interval: number) {
  const stream = new Readable({
    read() {}
  });

  const timers = new Set<NodeJS.Timeout>();
  let stopped = false;
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.clear();
    stream.push(null);
    resolveDone?.();
  };

  if (lines.length === 0) {
    queueMicrotask(stop);
    return { done, stream, stop };
  }

  for (const [index, line] of lines.entries()) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (stopped) {
        return;
      }

      stream.push(line);
      if (index === lines.length - 1) {
        stop();
      }
    }, interval * (index + 1));

    timers.add(timer);
  }

  return { done, stream, stop };
}

function createWritableStream(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
}
