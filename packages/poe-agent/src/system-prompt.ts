import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

const systemPromptUrl = new URL("./SYSTEM_PROMPT.md", import.meta.url);

export async function loadSystemPrompt(): Promise<string> {
  return readFile(systemPromptUrl, "utf8");
}

export function loadSystemPromptSync(): string {
  return readFileSync(systemPromptUrl, "utf8");
}
