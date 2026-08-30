import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { beforeAll, describe, expect, it, vi } from "vitest";

let bundle: string;

beforeAll(async () => {
  const output = await build({
    entryPoints: [fileURLToPath(new URL("../src/core.ts", import.meta.url))],
    bundle: true, platform: "browser", conditions: ["browser"], format: "iife",
    globalName: "core", target: "es2022", write: false, logLevel: "silent"
  });
  bundle = output.outputFiles[0]!.text;
});

function stage(crypto: unknown, collision?: string): { context: ReturnType<typeof createContext>; write: Promise<void> } {
  const context = createContext({ crypto, collision, Uint8Array, TextEncoder, TextDecoder, AbortController });
  runInContext(bundle, context);
  const write = runInContext(`
    const upper = new core.MemoryFileSystem();
    const lower = new core.MemoryFileSystem();
    const overlay = new core.OverlayFileSystem({ upper, lower });
    (async () => {
      if (collision) await lower.mkdir('/.virtual-bash-overlay-' + collision);
      await overlay.writeFile('/file', new Uint8Array([1]));
    })()
  `, context) as Promise<void>;
  return { context, write };
}

describe("browser secure staging entropy", () => {
  it.each([undefined, {}])("fails closed without secure crypto: %s", async crypto => {
    const operation = stage(crypto);
    await expect(operation.write).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(await runInContext("upper.readdir('/')", operation.context)).toEqual([]);
  });

  it("calls secure UUID generation with its receiver", async () => {
    const crypto = { randomUUID: vi.fn(function (this: unknown) {
      expect(this).toBe(crypto);
      return "00000000-0000-4000-8000-000000000001";
    }) };
    await stage(crypto).write;
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("uses secure bytes with UUID version and variant bits and refuses collisions", async () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      for (let index = 0; index < bytes.length; index++) bytes[index] = index;
      return bytes;
    });
    const operation = stage({ getRandomValues }, "00010203-0405-4607-8809-0a0b0c0d0e0f");
    await expect(operation.write).rejects.toMatchObject({ code: "EEXIST" });
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(await runInContext("upper.readdir('/')", operation.context)).toEqual([]);
  });

  it("preserves a secure-provider failure without fallback or writes", async () => {
    const failure = new Error("secure provider rejected");
    const getRandomValues = vi.fn();
    const operation = stage({ randomUUID: () => { throw failure; }, getRandomValues });
    await expect(operation.write).rejects.toBe(failure);
    expect(getRandomValues).not.toHaveBeenCalled();
    expect(await runInContext("upper.readdir('/')", operation.context)).toEqual([]);
  });
});
