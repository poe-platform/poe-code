import systemPromptContent from "./SYSTEM_PROMPT.md";

export async function loadSystemPrompt(): Promise<string> {
  return systemPromptContent;
}

export function loadSystemPromptSync(): string {
  return systemPromptContent;
}
