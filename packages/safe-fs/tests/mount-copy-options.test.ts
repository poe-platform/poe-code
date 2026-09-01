import { describe, expect, it, vi } from "vitest";
import { FsError, MemoryFileSystem, createMountFileSystem } from "../src/index.js";
import type { ByteSource, WriteFileOptions } from "../src/index.js";

class StrictDestination extends MemoryFileSystem {
  writes: WriteFileOptions[] = [];

  validate(options: WriteFileOptions) {
    for (const key of Object.keys(options)) {
      if (!["signal", "flag", "mode"].includes(key)) throw new FsError("EINVAL");
    }
    this.writes.push(options);
  }

  override async writeFile(path: string, data: Uint8Array, options: WriteFileOptions = {}) {
    this.validate(options);
    await super.writeFile(path, data, options);
  }

  override async writeStream(path: string, source: ByteSource, options: WriteFileOptions = {}) {
    this.validate(options);
    await super.writeStream(path, source, options);
  }
}

for (const streaming of [false, true]) {
  describe(`mount copy options, streaming=${streaming}`, () => {
    async function setup() {
      const reader = new MemoryFileSystem();
      Object.defineProperty(reader, "capabilities", { value: { ...reader.capabilities, streamingRead: streaming } });
      const writer = new StrictDestination();
      const bytes = new TextEncoder().encode("payload");
      await reader.writeFile("/source", bytes, { mode: 0o640 });
      const fs = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/source": reader, "/target": writer } });
      return { reader, writer, bytes, fs };
    }

    it.each(["omitted", "signal", "exclusive-false", "exclusive-true"])("translates %s options", async label => {
      const { writer, bytes, fs } = await setup();
      const signal = new AbortController().signal;
      const options = label === "omitted" ? undefined : label === "signal" ? { signal } : { signal, exclusive: label === "exclusive-true" };
      await fs.copyFile("/source/source", "/target/copy", options);
      expect(await writer.readFile("/copy")).toEqual(bytes);
      expect((await writer.stat("/copy")).mode & 0o777).toBe(0o640);
      expect(writer.writes[0]).toEqual({ signal: options?.signal, flag: "wx", mode: 0o640 });
    });

    it("overwrites with w, but rejects an exclusive existing target", async () => {
      const { writer, bytes, fs } = await setup();
      await writer.writeFile("/copy", new Uint8Array([9]));
      writer.writes.length = 0;
      await expect(fs.copyFile("/source/source", "/target/copy", { exclusive: true })).rejects.toMatchObject({ code: "EEXIST" });
      expect(writer.writes).toHaveLength(0);
      await fs.copyFile("/source/source", "/target/copy", { exclusive: false });
      expect(writer.writes[0]?.flag).toBe("w");
      expect(await writer.readFile("/copy")).toEqual(bytes);
    });

    it("retains atomic creation when a missing target appears during transfer", async () => {
      const { writer, fs } = await setup();
      const original = new Uint8Array([9]);
      if (streaming) {
        const write = writer.writeStream.bind(writer);
        writer.writeStream = async (path, source, options) => {
          await MemoryFileSystem.prototype.writeFile.call(writer, path, original);
          await write(path, source, options);
        };
      } else {
        const write = writer.writeFile.bind(writer);
        writer.writeFile = async (path, bytes, options) => {
          await MemoryFileSystem.prototype.writeFile.call(writer, path, original);
          await write(path, bytes, options);
        };
      }
      await expect(fs.copyFile("/source/source", "/target/copy", { exclusive: false })).rejects.toMatchObject({ code: "EEXIST" });
      expect(writer.writes[0]?.flag).toBe("wx");
      expect(await writer.readFile("/copy")).toEqual(original);
    });

    it("omits mode when destination permissions are unsupported", async () => {
      const { writer, fs } = await setup();
      Object.defineProperty(writer, "capabilities", { value: { ...writer.capabilities, permissions: false } });
      await fs.copyFile("/source/source", "/target/copy", { exclusive: false });
      expect(writer.writes[0]).not.toHaveProperty("mode");
    });

    it("forwards cancellation without publishing data", async () => {
      const { reader, writer, fs } = await setup();
      const controller = new AbortController();
      const reason = new Error("cancel copy");
      const closed = vi.fn();
      if (streaming) {
        reader.readStream = (_path, options) => (async function* () {
          try {
            expect(options?.signal).toBe(controller.signal);
            controller.abort(reason);
            yield new Uint8Array([1]);
          } finally { closed(); }
        })();
      } else {
        reader.readFile = async (_path, options) => {
          expect(options?.signal).toBe(controller.signal);
          controller.abort(reason);
          return new Uint8Array([1]);
        };
      }
      await expect(fs.copyFile("/source/source", "/target/copy", { signal: controller.signal, exclusive: false })).rejects.toBe(reason);
      if (streaming) expect(closed).toHaveBeenCalledOnce();
      if (streaming) expect((await writer.readFile("/copy")).byteLength).toBe(0);
      else await expect(writer.stat("/copy")).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
}
