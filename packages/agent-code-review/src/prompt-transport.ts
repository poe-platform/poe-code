export function shouldUseTextStdinForCodeReview(agent: string): boolean {
  return agent === "codex" || agent === "claude-code";
}
