declare module "braintrust" {
  export function initLogger(options: {
    projectName: string;
    apiKey: string;
    apiUrl?: string;
  }): unknown;

  export function initExperiment(options: {
    projectName: string;
    experimentName: string;
    apiKey: string;
    apiUrl?: string;
  }): unknown;

  export function flush(target: unknown): Promise<void>;

  export interface Span {
    startSpan(args: { name: string; type: "task" | "tool" }): Span;
    log(event: {
      input?: unknown;
      output?: unknown;
      metadata?: Record<string, unknown>;
      metrics?: Record<string, number>;
      tags?: string[];
    }): void;
    end(): void;
  }

  export function currentSpan(): Span;

  export function traced<T>(
    fn: () => Promise<T>,
    args: {
      name: string;
      type: "task";
      event?: {
        tags?: string[];
      };
    },
  ): Promise<T>;
}
