import { yieldTurn } from "safe-bash-contracts/yield";
import { clearMmdcFontCaches } from "./font.js";

export function drainWork<T>(work: Generator<void, T, void>): T {
  try {
    let step = work.next();
    while (!step.done) step = work.next();
    return step.value;
  } finally {
    clearMmdcFontCaches();
  }
}

export async function runWork<T>(work: Generator<void, T, void>, signal?: AbortSignal): Promise<T> {
  try {
    let step = work.next();
    while (!step.done) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      step = work.next();
    }
    signal?.throwIfAborted();
    return step.value;
  } finally {
    work.return(undefined as T);
    clearMmdcFontCaches();
  }
}
