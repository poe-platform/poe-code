import { expect, it, vi } from "vitest";
import { createMemoryFileSystem, createNodeFsBridge } from "@poe-code/safe-fs";

it("passes a trusted read cap to the backend before materializing bytes", async () => {
  const adapter = createMemoryFileSystem();
  await adapter.writeFile("/large", new Uint8Array(1024));
  const read = vi.spyOn(adapter, "readFile");
  const bridge = createNodeFsBridge(adapter, { readFileMaxBytes: 16 });
  await expect(bridge.readFile("/large", "utf8")).rejects.toMatchObject({ code: "EFBIG" });
  expect(read.mock.calls[0]?.[1]?.maxBytes).toBe(16);
  await expect(read.mock.results[0]!.value).rejects.toMatchObject({ code: "EFBIG" });
});

it("refuses an adapter result larger than the cap before copy or decode", async () => {
  const adapter = createMemoryFileSystem();
  vi.spyOn(adapter, "readFile").mockResolvedValue(new Uint8Array(17));
  await expect(createNodeFsBridge(adapter, { readFileMaxBytes: 16 }).readFile("/large", "hex"))
    .rejects.toMatchObject({ code: "EFBIG" });
});

it("validates trusted caps and admits empty and small files", async () => {
  const adapter = createMemoryFileSystem();
  for (const maximum of [-1, 0.5, Infinity, NaN]) {
    expect(() => createNodeFsBridge(adapter, { readFileMaxBytes: maximum })).toThrow(TypeError);
  }
  await adapter.writeFile("/empty", new Uint8Array());
  expect(await createNodeFsBridge(adapter, { readFileMaxBytes: 0 }).readFile("/empty", "utf8")).toBe("");
  await adapter.writeFile("/small", new Uint8Array([65]));
  expect(await createNodeFsBridge(adapter, { readFileMaxBytes: 1 }).readFile("/small", "hex")).toBe("41");
});
