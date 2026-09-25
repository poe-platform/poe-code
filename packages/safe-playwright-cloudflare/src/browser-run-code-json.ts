/** The caller enforces any explicit output budget before decoding. */
export function parseRunCodeJson(json: string, signal: AbortSignal): unknown {
  signal.throwIfAborted();
  const result: unknown = JSON.parse(json);
  signal.throwIfAborted();
  return result;
}
