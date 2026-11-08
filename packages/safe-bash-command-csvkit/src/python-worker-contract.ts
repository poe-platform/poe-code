export interface Endpoint {
  postMessage(message: unknown): void;
  terminate(): void | Promise<unknown>;
  onMessage(callback: (message: Message) => void, failure: (error: unknown) => void): void;
}
export type Message = {type: 'io'; channel: 'stdin' | 'stdout' | 'stderr' | 'reader'; size: number; work: number} |
  {type: 'done'; exitCode: number; work: number} | {type: 'error'; message: string; work: number};

