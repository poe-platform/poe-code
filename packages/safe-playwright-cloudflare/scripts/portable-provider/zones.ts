/** Browser hosts have no ambient async call stack. API calls carry their own
 * metadata; never share a mutable context across concurrent calls. */
export class AsyncLocalStorage {
  getStore(): undefined { return undefined; }
  run<T, A extends unknown[]>(_value: unknown, callback: (...args: A) => T, ...args: A): T {
    return callback(...args);
  }
}
