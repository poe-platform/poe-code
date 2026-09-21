export declare function renderToolStart(kind: string, title: string): void;
export declare function renderToolComplete(kind: string): void;
export declare function renderReasoning(text: string): void;
export declare function renderUsage(tokens: {
  input: number;
  output: number;
  cached?: number;
  costUsd?: number;
}): void;
export declare function renderError(message: string): void;
export declare function renderPermissionRejected(title: string): void;
