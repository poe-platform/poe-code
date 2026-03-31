import { describe, it, expect } from "bun:test";
import {
  createMemFs,
  createMockCachedResource,
} from "./index.js";

describe("createMemFs", () => {
  it("creates a DiskCacheFs from empty volume", async () => {
    const fs = createMemFs();

    await fs.mkdir("/cache", { recursive: true });
    await fs.writeFile("/cache/test.json", '{"data":"hello"}');
    const content = await fs.readFile("/cache/test.json", "utf8");

    expect(content).toBe('{"data":"hello"}');
  });

  it("creates a DiskCacheFs pre-populated with files", async () => {
    const fs = createMemFs({
      "/cache/test.json": '{"data":"preloaded"}',
    });

    const content = await fs.readFile("/cache/test.json", "utf8");

    expect(content).toBe('{"data":"preloaded"}');
  });

  it("unlink removes files", async () => {
    const fs = createMemFs({
      "/cache/test.json": "content",
    });

    await fs.unlink("/cache/test.json");

    await expect(fs.readFile("/cache/test.json", "utf8")).rejects.toThrow();
  });
});

describe("createMockCachedResource", () => {
  it("get returns bundled data by default", async () => {
    const resource = createMockCachedResource(["a", "b"]);

    const result = await resource.get();

    expect(result.data).toEqual(["a", "b"]);
    expect(result.timestamp).toBe(0);
  });

  it("refresh returns bundled data by default", async () => {
    const resource = createMockCachedResource({ key: "value" });

    const result = await resource.refresh();

    expect(result.data).toEqual({ key: "value" });
  });

  it("clear resolves without error", async () => {
    const resource = createMockCachedResource("data");

    await expect(resource.clear()).resolves.toBeUndefined();
  });

  it("stats returns zeroed stats", () => {
    const resource = createMockCachedResource("data");

    const stats = resource.stats();

    expect(stats).toEqual({
      memoryCacheSize: 0,
      memoryCacheMax: 0,
      cacheDir: "",
    });
  });

  it("get is a spy that can be overridden", async () => {
    const resource = createMockCachedResource("default");

    resource.get.mockResolvedValueOnce({ data: "custom", timestamp: 999 });

    const result = await resource.get();

    expect(result.data).toBe("custom");
    expect(result.timestamp).toBe(999);
  });

  it("refresh is a spy that can be overridden", async () => {
    const resource = createMockCachedResource("default");

    resource.refresh.mockResolvedValueOnce({ data: "refreshed", timestamp: 1 });

    const result = await resource.refresh();

    expect(result.data).toBe("refreshed");
  });

  it("clear is a spy that can be overridden", async () => {
    const resource = createMockCachedResource("data");

    resource.clear.mockRejectedValueOnce(new Error("fail"));

    await expect(resource.clear()).rejects.toThrow("fail");
  });

  it("stats is a spy that can be overridden", () => {
    const resource = createMockCachedResource("data");

    resource.stats.mockReturnValueOnce({
      memoryCacheSize: 5,
      memoryCacheMax: 100,
      cacheDir: "/custom",
    });

    expect(resource.stats().memoryCacheSize).toBe(5);
  });
});
