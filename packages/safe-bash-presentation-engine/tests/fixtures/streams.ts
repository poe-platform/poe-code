import type { ByteSource, FileSystem } from "@poe-code/safe-fs/core";

/** A chunk producer fixture with explicit EOF, including reusable and empty chunks. */
export function chunksFromReader(source: {
  read(size: number): Promise<Uint8Array | null>;
}): ByteSource {
  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const bytes = await source.read(65536);
        if (bytes === null) return;
        yield bytes;
      }
    }
  };
}

export function streamingFileSystem(source: {
  openRead(path: string): Promise<ByteSource>;
}): Pick<FileSystem, "readFile" | "readStream"> {
  return {
    async readFile() {
      throw new Error("Expected streaming read");
    },
    async *readStream(path) {
      yield* await source.openRead(path);
    }
  };
}
