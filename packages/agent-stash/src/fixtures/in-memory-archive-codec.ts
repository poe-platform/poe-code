import type { ArchiveCodec } from "../types.js";

export class InMemoryArchiveCodec implements ArchiveCodec {
  readonly archives = new Map<string, Record<string, string>>();

  async write(outputPath: string, files: Record<string, string>): Promise<void> {
    this.archives.set(outputPath, { ...files });
  }

  async read(inputPath: string): Promise<Record<string, string>> {
    const files = this.archives.get(inputPath);
    if (!files) {
      throw new Error(`Archive not found: ${inputPath}`);
    }
    return { ...files };
  }
}
