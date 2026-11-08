export type OpConfirmOverwrite = (
  intent: Readonly<{ path: string }>,
  context: Readonly<{ signal: AbortSignal }>,
) => boolean | Promise<boolean>;

export type OpSelectPlugin = (
  candidates: readonly Readonly<{ id: string; name: string }>[],
  context: Readonly<{ signal: AbortSignal; accountId: string | null }>,
) => string | undefined | Promise<string | undefined>;
