import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";

export async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
