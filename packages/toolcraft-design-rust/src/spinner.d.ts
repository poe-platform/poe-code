export interface SpinnerOptions {
  start: (message?: string) => void;
  stop: (message?: string, code?: number) => void;
  message: (message?: string) => void;
}
export declare function spinner(): SpinnerOptions;
