export declare function selectViewportTail<T, R>(items: readonly T[], height: number, offset: number, renderRows: (item: T) => readonly R[]): {
  rows: R[];
  offset: number;
};
export declare function createViewport<T extends { id: string }>({ capacity }: { capacity: number }): {
  append(item: T): void;
  scroll(delta: number): void;
  items(): readonly T[];
  offset(): number;
  unseen(): number;
  find(predicate: (item: T) => boolean): number;
  follow(): void;
};
