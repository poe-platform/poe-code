import type { AgentTraceFileSystem } from "../types.js";

export const DEFAULT_HEAD_BYTES = 65_536;

interface OpenCapableFileSystem {
  open(
    path: string,
    flags: string
  ): Promise<{
    read(
      buffer: Buffer,
      offset: number,
      length: number,
      position: number
    ): Promise<{ bytesRead: number }>;
    close(): Promise<void>;
  }>;
}

function supportsOpen(fs: AgentTraceFileSystem): fs is AgentTraceFileSystem & OpenCapableFileSystem {
  return typeof (fs as Partial<OpenCapableFileSystem>).open === "function";
}

export async function readHead(
  fs: AgentTraceFileSystem,
  filePath: string,
  maxBytes = DEFAULT_HEAD_BYTES
): Promise<string> {
  if (supportsOpen(fs)) {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.toString("utf8", 0, bytesRead);
    } finally {
      await handle.close();
    }
  }
  const contents = await fs.readFile(filePath, "utf8");
  return contents.length > maxBytes ? contents.slice(0, maxBytes) : contents;
}
