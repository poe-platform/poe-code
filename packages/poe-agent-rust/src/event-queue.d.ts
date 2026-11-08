export declare class AsyncEventQueue<T> implements AsyncIterableIterator<T> {
  constructor(onReturn: () => void);
  onReturn: () => void;
  push(item: T): void;
  close(): void;
  next(): Promise<IteratorResult<T>>;
  return(): Promise<IteratorResult<T>>;
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}
