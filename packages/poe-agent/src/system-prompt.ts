import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SYSTEM_PROMPT_PATH = fileURLToPath(new URL("./SYSTEM_PROMPT.md", import.meta.url));

export async function loadSystemPrompt(): Promise<string> {
  return await readFile(SYSTEM_PROMPT_PATH, "utf8");
}

export function loadSystemPromptSync(): string {
  return readFileSync(SYSTEM_PROMPT_PATH, "utf8");
}
