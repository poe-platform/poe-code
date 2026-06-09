import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { hasOwnErrorCode } from "./errors.js";

export async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let tempCreated = false;

  try {
    await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    tempCreated = true;
    await fs.rename(tempPath, filePath);
    tempCreated = false;
  } catch (error) {
    if (tempCreated || !isExistingPath(error)) {
      await fs.unlink(tempPath).catch(() => undefined);
    }
    throw error;
  }
}

function isExistingPath(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}
