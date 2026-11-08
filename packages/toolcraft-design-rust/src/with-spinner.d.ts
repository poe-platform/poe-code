export interface WithSpinnerOptions<T> {
  message: string | (() => string);
  fn: () => Promise<T>;
  stopMessage?: (result: T) => string;
  subtext?: (result: T) => string | undefined;
}
export declare function withSpinner<T>(options: WithSpinnerOptions<T>): Promise<T>;
