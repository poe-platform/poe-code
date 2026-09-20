/** Avoid unused JavaScript stack capture during synchronous oracle matrices. */
export function withoutErrorStacks<T>(operation: () => T): T {
  const previous = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  try {
    return operation();
  } finally {
    Error.stackTraceLimit = previous;
  }
}
