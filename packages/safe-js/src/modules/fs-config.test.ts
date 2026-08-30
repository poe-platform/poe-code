import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem, FileSystemFactory } from "@poe-code/safe-fs";
import { parseFsConfig, resolveFsConfig } from "./fs-config.js";
import * as sdk from "../index.js";

const factories = vi.hoisted(() => ({ memory: vi.fn(), real: vi.fn() }));
vi.mock("../../../safe-fs/src/fs/memory/index.js", () => ({
  createMemoryFileSystem: factories.memory
}));
vi.mock("../../../safe-fs/src/fs/real/index.js", () => ({ createRealFileSystem: factories.real }));

const filesystem = Object.create(null) as FileSystem;
const memory = { adapter: { type: "memory", options: {} } };

describe("SafeJS filesystem configuration SDK", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    factories.memory.mockReturnValue(filesystem);
    factories.real.mockResolvedValue(filesystem);
  });

  it("exports both helpers from the public SDK", () => {
    expect(Reflect.get(sdk, "parseFsConfig")).toBe(parseFsConfig);
    expect(Reflect.get(sdk, "resolveFsConfig")).toBe(resolveFsConfig);
  });

  it("parses JSON without constructing an adapter", () => {
    expect(parseFsConfig(JSON.stringify(memory))).toEqual(memory);
    expect(factories.memory).not.toHaveBeenCalled();
    expect(factories.real).not.toHaveBeenCalled();
  });

  it.each([
    "null",
    "[]",
    '"memory"',
    "{}",
    '{"adapter":null}',
    '{"adapter":[]}',
    '{"adapter":{"type":"memory"},"fs":{}}',
    '{"adapter":{"type":"memory"},"unknown":true}',
    '{"adapter":{"type":"memory","unknown":true}}',
    '{"adapter":{"type":"memory","options":[]}}'
  ])("rejects malformed or conflicting JSON %s without backend I/O", (json) => {
    expect(() => parseFsConfig(json)).toThrow(TypeError);
    expect(factories.memory).not.toHaveBeenCalled();
    expect(factories.real).not.toHaveBeenCalled();
  });

  it.each(["", " ", "relative", "/bad\0path", null, 3])(
    "validates virtual root %j before constructing real storage",
    async (root) => {
      const config = { adapter: { type: "real", options: { root: "/host" } }, root };
      expect(() => parseFsConfig(JSON.stringify(config))).toThrow(TypeError);
      await expect(resolveFsConfig(config as never)).rejects.toThrow(TypeError);
      expect(factories.real).not.toHaveBeenCalled();
    }
  );

  it("separates the real host root from virtual confinement", async () => {
    const config = { adapter: { type: "real", options: { root: "/host" } }, root: "/work" };
    expect(await resolveFsConfig(config)).toEqual({ adapter: filesystem, root: "/work" });
    expect(factories.real).toHaveBeenCalledExactlyOnceWith({ root: "/host" });
  });

  it("preserves omitted confinement instead of substituting virtual slash", async () => {
    const options = await resolveFsConfig(memory);
    expect(options.adapter).toBe(filesystem);
    expect(options).not.toHaveProperty("root");
  });

  it.each([
    { cwd: "/work" },
    { cwd: "/" },
    { root: "/work", cwd: "/work/nested" },
    { root: "/work", cwd: "/elsewhere" },
    { root: "/work", cwd: "/work/../elsewhere" }
  ])("preserves independent virtual path options %j", async (paths) => {
    const config: sdk.FsConfig = {
      adapter: { type: "real", options: { root: "/host" } },
      ...paths
    };
    expect(parseFsConfig(JSON.stringify(config))).toEqual(config);
    expect(factories.real).not.toHaveBeenCalled();
    expect(await resolveFsConfig(config)).toEqual({ adapter: filesystem, ...paths });
    expect(factories.real).toHaveBeenCalledExactlyOnceWith({ root: "/host" });
  });

  it.each([{}, { root: "/work" }])("preserves omitted cwd with %j", async (paths) => {
    const config = { ...memory, ...paths };
    expect(parseFsConfig(JSON.stringify(config))).not.toHaveProperty("cwd");
    const resolved = await resolveFsConfig({ ...config, cwd: undefined });
    expect(resolved).toEqual({ adapter: filesystem, ...paths });
    expect(resolved).not.toHaveProperty("cwd");
  });

  it.each(["", " ", "relative", "/bad\0cwd", null, 3, [], {}].map((cwd) => ({ cwd })))(
    "rejects invalid virtual cwd $cwd before construction",
    async ({ cwd }) => {
      const config = { ...memory, root: "/work", cwd };
      expect(() => parseFsConfig(JSON.stringify(config))).toThrow(
        "cwd must be an absolute virtual path"
      );
      await expect(resolveFsConfig(config as never)).rejects.toThrow(
        "cwd must be an absolute virtual path"
      );
      expect(factories.memory).not.toHaveBeenCalled();
      expect(factories.real).not.toHaveBeenCalled();
    }
  );

  it("validates cwd before invoking a caller descriptor validator or factory", async () => {
    const validateOptions = vi.fn();
    const create = vi.fn<FileSystemFactory>();
    const config = { adapter: { type: "future" }, cwd: "relative" };
    await expect(
      resolveFsConfig(config, { registry: new Map([["future", { validateOptions, create }]]) })
    ).rejects.toThrow("cwd must be an absolute virtual path");
    expect(validateOptions).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an accessor cwd without invoking it", async () => {
    const getter = vi.fn(() => "/work");
    const config = Object.defineProperty({ ...memory }, "cwd", { get: getter });
    await expect(resolveFsConfig(config)).rejects.toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
    expect(factories.memory).not.toHaveBeenCalled();
  });

  it.each([null, "host-signal", { aborted: false }])(
    "rejects JSON signal %j instead of treating it as a host capability",
    async (signal) => {
      const config = { ...memory, cwd: "/work", signal };
      expect(() => parseFsConfig(JSON.stringify(config))).toThrow("Unknown fs config: signal");
      await expect(resolveFsConfig(config)).rejects.toThrow("Unknown fs config: signal");
      expect(factories.memory).not.toHaveBeenCalled();
    }
  );

  it.each([{ cwd: "/work" }, { signal: new AbortController().signal }])(
    "rejects misplaced resolution options %j",
    async (options) => {
      await expect(resolveFsConfig(memory, options as never)).rejects.toThrow(
        "Unknown fs resolution option"
      );
      expect(factories.memory).not.toHaveBeenCalled();
    }
  );

  it("uses caller adapter validation and construction without backend-name branching", async () => {
    const validateOptions = vi.fn();
    const create = vi.fn<FileSystemFactory>().mockResolvedValue(filesystem);
    const options = { transport: { explicitlyConfigured: true } };
    expect(
      await resolveFsConfig(
        { adapter: { type: "future", options } },
        {
          registry: new Map([["future", { validateOptions, create }]])
        }
      )
    ).toEqual({ adapter: filesystem });
    expect(validateOptions).toHaveBeenCalledExactlyOnceWith(options);
    expect(create).toHaveBeenCalledExactlyOnceWith(options);
    expect(factories.real).not.toHaveBeenCalled();
    expect(factories.memory).not.toHaveBeenCalled();
  });

  it.each(["memory", "real"])(
    "rejects a caller collision with %s before either factory",
    async (type) => {
      const create = vi.fn<FileSystemFactory>();
      await expect(
        resolveFsConfig(memory, {
          registry: new Map([[type, { validateOptions: vi.fn(), create }]])
        })
      ).rejects.toThrow(`Filesystem adapter already registered: ${type}`);
      expect(create).not.toHaveBeenCalled();
      expect(factories.memory).not.toHaveBeenCalled();
      expect(factories.real).not.toHaveBeenCalled();
    }
  );

  it("rejects unknown SDK resolution options instead of ignoring configuration", async () => {
    await expect(resolveFsConfig(memory, { fs: {} } as never)).rejects.toThrow(TypeError);
    expect(factories.memory).not.toHaveBeenCalled();
  });

  it.each([null, [], {}].map((registry) => ({ registry })))(
    "rejects invalid caller registry $registry without using defaults",
    async ({ registry }) => {
      await expect(resolveFsConfig(memory, { registry } as never)).rejects.toThrow(TypeError);
      expect(factories.memory).not.toHaveBeenCalled();
      expect(factories.real).not.toHaveBeenCalled();
    }
  );

  it("rejects an explicit unknown adapter rather than falling back to host storage", async () => {
    await expect(resolveFsConfig({ adapter: { type: "unregistered" } })).rejects.toThrow(
      "Unknown filesystem adapter: unregistered"
    );
    expect(factories.memory).not.toHaveBeenCalled();
    expect(factories.real).not.toHaveBeenCalled();
  });
});
