export interface HostCallbackContext {
  run<Result>(value: boolean, callback: () => Result): Result;
  getStore(): boolean | undefined;
  disable(): void;
}
