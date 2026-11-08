import path from "node:path";
import { promises as nodeFs } from "node:fs";
import type { AgentTraceFileSystem, HumanPromptRecord } from "./types.js";

export async function writeHumanPromptJsonl(
  records: HumanPromptRecord[],
  filePath: string,
  fs: AgentTraceFileSystem = nodeFs
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = records.map((record) => JSON.stringify(record)).join("\n");
  await fs.writeFile(filePath, content.length === 0 ? "" : `${content}\n`, { encoding: "utf8" });
}
