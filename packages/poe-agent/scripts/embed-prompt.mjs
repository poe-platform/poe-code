import { readFile, writeFile, copyFile } from "node:fs/promises";
const content = await readFile("src/SYSTEM_PROMPT.md", "utf8");
await writeFile("dist/system-prompt-data.js", `export const systemPrompt = ${JSON.stringify(content)};\n`);
await copyFile("src/SYSTEM_PROMPT.md", "dist/SYSTEM_PROMPT.md");
