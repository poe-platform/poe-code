export declare function createDashboardLineBuffer(emit: (line: string) => void): {
  push(chunk: string): void;
  flush(): void;
  preview(): string;
};
export declare function createStreamingDashboardLineBuffer(
  emit: (line: string, id: string) => void
): {
  push(chunk: string): void;
  flush(): void;
};
