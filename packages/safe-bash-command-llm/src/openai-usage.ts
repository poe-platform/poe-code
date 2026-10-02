/** Preserve native SDK fields and expose the shared LLM token-usage shape. */
export function openAiUsage(usage: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  function clean(value: unknown): unknown {
    if (value === 0 || value === false || value === null) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const entries = Object.entries(value).flatMap(([key, item]) => {
      const cleaned = clean(item);
      return cleaned === undefined ? [] : [[key, cleaned]];
    });
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  const { prompt_tokens, completion_tokens, total_tokens: ignoredTotal, ...rest } = usage;
  const details = clean(rest);
  return { ...usage, ...(prompt_tokens === undefined ? {} : { input: prompt_tokens }), ...(completion_tokens === undefined ? {} : { output: completion_tokens }), ...(details === undefined ? {} : { details }) };
}
