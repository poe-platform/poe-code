import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import type { FileSystem } from "../src/contracts/filesystem.js";

const encode = (value: string) => new TextEncoder().encode(value);

describe("overlay read admission", () => {
  for (const kind of ["buffered", "retained", "streaming"] as const) {
    for (const replacement of ["symlink", "directory"] as const) {
      for (const timing of ["before", "after"] as const) {
        it(`rejects ${replacement} swaps ${timing} ${kind} acquisition`, async () => {
          const upper = new MemoryFileSystem();
          const lower = new MemoryFileSystem();
          for (const fs of [upper, lower]) await fs.mkdir("/secret");
          await upper.writeFile("/secret/file", encode("visible-upper"));
          await lower.writeFile("/secret/file", encode("HIDDEN-LOWER-SECRET"));
          await lower.mkdir("/public");
          await lower.writeFile("/public/file", encode("public-lower"));
          let swapped = false;
          const backend = new Proxy(lower, {
            get(target, key) {
              const value = Reflect.get(target, key);
              if (typeof value !== "function") return value;
              const invoke = async (...args: unknown[]) => {
                if (!swapped && args[0] === "/public/file" &&
                    ["readFile", "readStream", "openReadFile"].includes(String(key))) {
                  swapped = true;
                  const acquired = timing === "after" ? await Reflect.apply(value, target, args) : undefined;
                  await lower.rename("/public", "/old-public");
                  if (replacement === "symlink") await lower.symlink("/secret", "/public");
                  else {
                    await lower.mkdir("/public");
                    await lower.writeFile("/public/file", encode("HIDDEN-LOWER-SECRET"));
                  }
                  if (timing === "after") return acquired;
                }
                return Reflect.apply(value, target, args);
              };
              if (key === "readStream") return async function* (...args: unknown[]) {
                yield* (await invoke(...args)) as AsyncIterable<Uint8Array>;
              };
              return invoke;
            },
          }) as FileSystem;
          const overlay = new OverlayFileSystem({ upper, lower: backend });
          const read = async () => {
            if (kind === "buffered") return overlay.readFile("/public/file");
            if (kind === "retained") {
              const handle = await overlay.openReadFile("/public/file");
              try { return await handle.read(0, 100); } finally { await handle.close(); }
            }
            const chunks = [];
            for await (const chunk of overlay.readStream("/public/file")) chunks.push(chunk);
            return chunks;
          };
          await expect(read()).rejects.toMatchObject({ code: "ENOTSUP" });
        });
      }
    }
  }
});
