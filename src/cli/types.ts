export type PromptFn = (
  questions: unknown
) => Promise<Record<string, unknown>>;

export type LoggerFn = (message: string) => void;
