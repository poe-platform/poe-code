export declare function createOverlayManager(initialFocus: string): {
  open(focus: string): AbortSignal;
  close(): boolean;
  focus(): string;
  dispose(): void;
};
