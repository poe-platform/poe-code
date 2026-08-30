import { hasOwnErrorCode } from "./error-codes.js";

export type OutputStream = {
  off?(event: "error", listener: (error: unknown) => void): void;
  on?(event: "error", listener: (error: unknown) => void): void;
  write(chunk: string): void;
};

export type BrokenPipeState = {
  closed: boolean;
};

export function createBrokenPipeState(): BrokenPipeState {
  return { closed: false };
}

export function createSafeOutputStream(
  stream: OutputStream,
  brokenPipe: BrokenPipeState
): OutputStream {
  return {
    write(chunk) {
      if (brokenPipe.closed) {
        return;
      }

      try {
        stream.write(chunk);
      } catch (error) {
        if (isBrokenPipeError(error)) {
          brokenPipe.closed = true;
          return;
        }

        throw error;
      }
    }
  };
}

export async function withBrokenPipeGuard<TResult>(
  streams: readonly OutputStream[],
  brokenPipe: BrokenPipeState,
  callback: () => Promise<TResult>
): Promise<TResult> {
  const removeListeners = streams.map((stream) => addBrokenPipeListener(stream, brokenPipe));

  try {
    return await callback();
  } finally {
    for (const removeListener of removeListeners) {
      removeListener();
    }
  }
}

export function addBrokenPipeListener(
  stream: OutputStream,
  brokenPipe: BrokenPipeState
): () => void {
  const onError = (error: unknown) => {
    if (isBrokenPipeError(error)) {
      brokenPipe.closed = true;
      return;
    }

    throw error;
  };

  stream.on?.("error", onError);
  return () => {
    stream.off?.("error", onError);
  };
}

function isBrokenPipeError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EPIPE");
}
