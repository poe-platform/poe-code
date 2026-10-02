import { systemPrompt } from "#agent-system-prompt";
export async function loadSystemPrompt(): Promise<string> { return systemPrompt; }
export function loadSystemPromptSync(): string { return systemPrompt; }
