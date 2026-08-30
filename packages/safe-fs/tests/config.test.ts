import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem, FileSystemFactory } from "../src/contracts/filesystem.js";
import {
  createFileSystem,
  validateFileSystemConfig,
  type FileSystemAdapterDescriptor
} from "../src/config.js";
import { createNodeFileSystemAdapterRegistry } from "../src/config.node.js";
import { createMemoryFileSystemAdapter } from "../src/config/memory.js";
import { createRealFileSystemAdapter } from "../src/config/real.js";
import * as publicFs from "../src/index.js";

const factories = vi.hoisted(() => ({ memory: vi.fn(), real: vi.fn() }));

vi.mock("../src/fs/memory/index.js", () => ({ createMemoryFileSystem: factories.memory }));
vi.mock("../src/fs/real/index.js", () => ({ createRealFileSystem: factories.real }));

const filesystem = Object.create(null) as FileSystem;

describe("filesystem configuration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    factories.memory.mockReturnValue(filesystem);
    factories.real.mockResolvedValue(filesystem);
  });

  it("publishes configuration functions and the Node registry through the existing package entry", () => {
    expect(Reflect.get(publicFs, "createFileSystem")).toBe(createFileSystem);
    expect(Reflect.get(publicFs, "validateFileSystemConfig")).toBe(validateFileSystemConfig);
    expect(Reflect.get(publicFs, "createNodeFileSystemAdapterRegistry")).toBe(
      createNodeFileSystemAdapterRegistry
    );
  });

  it("validates then awaits the explicitly registered factory without copying its result", async () => {
    const events: string[] = [];
    const options = { nested: { future: ["value"] } };
    const descriptor: FileSystemAdapterDescriptor = {
      validateOptions: vi.fn(() => {
        events.push("validate");
      }),
      create: vi.fn<FileSystemFactory>(async () => {
        events.push("create");
        return filesystem;
      })
    };
    expect(
      await createFileSystem(
        { type: "future", options },
        { registry: new Map([["future", descriptor]]) }
      )
    ).toBe(filesystem);
    expect(events).toEqual(["validate", "create"]);
    expect(descriptor.validateOptions).toHaveBeenCalledExactlyOnceWith(options);
    expect(descriptor.create).toHaveBeenCalledExactlyOnceWith(options);
  });

  it.each(
    [
      null,
      [],
      false,
      {},
      { type: "" },
      { type: " " },
      { type: 3 },
      { type: "memory", extra: true },
      { type: "memory", options: null },
      { type: "memory", options: [] },
      { type: "memory", options: new Date() }
    ].map((config) => ({ config }))
  )("rejects malformed envelope $config before validation or construction", async ({ config }) => {
    const descriptor = { validateOptions: vi.fn(), create: vi.fn<FileSystemFactory>() };
    await expect(
      createFileSystem(config as never, { registry: new Map([["memory", descriptor]]) })
    ).rejects.toThrow(TypeError);
    expect(descriptor.validateOptions).not.toHaveBeenCalled();
    expect(descriptor.create).not.toHaveBeenCalled();
  });

  it("rejects accessors without evaluating them", () => {
    const getter = vi.fn();
    const config = Object.defineProperty({}, "type", { get: getter, enumerable: true });
    expect(() => validateFileSystemConfig(config)).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not supply ambient Node adapters to an empty registry", async () => {
    await expect(
      createFileSystem({ type: "real", options: { root: "/host" } }, { registry: new Map() })
    ).rejects.toThrow("Unknown filesystem adapter: real");
    expect(factories.real).not.toHaveBeenCalled();
  });

  it("rejects a misplaced confinement root instead of silently ignoring it", async () => {
    const create = vi.fn<FileSystemFactory>().mockReturnValue(filesystem);
    const registry = new Map([["custom", { validateOptions: vi.fn(), create }]]);
    await expect(
      createFileSystem({ type: "custom" }, { registry, root: "/work" } as never)
    ).rejects.toThrow(TypeError);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an accessor registry without invoking it or a factory", async () => {
    const create = vi.fn<FileSystemFactory>().mockReturnValue(filesystem);
    const registry = new Map([["custom", { validateOptions: vi.fn(), create }]]);
    const getter = vi.fn(() => registry);
    const options = Object.defineProperty({}, "registry", { get: getter });
    await expect(createFileSystem({ type: "custom" }, options as never)).rejects.toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates option validation failures before factory I/O", async () => {
    const failure = new TypeError("invalid backend options");
    const descriptor = {
      validateOptions: vi.fn(() => {
        throw failure;
      }),
      create: vi.fn<FileSystemFactory>()
    };
    await expect(
      createFileSystem({ type: "custom" }, { registry: new Map([["custom", descriptor]]) })
    ).rejects.toBe(failure);
    expect(descriptor.create).not.toHaveBeenCalled();
  });

  it("does not retry or replace a rejected backend factory", async () => {
    const failure = new Error("backend unavailable");
    const descriptor = {
      validateOptions: vi.fn(),
      create: vi.fn<FileSystemFactory>().mockRejectedValue(failure)
    };
    await expect(
      createFileSystem({ type: "custom" }, { registry: new Map([["custom", descriptor]]) })
    ).rejects.toBe(failure);
    expect(descriptor.create).toHaveBeenCalledOnce();
    expect(factories.real).not.toHaveBeenCalled();
  });

  it("binds memory without importing or calling a host-directory factory", async () => {
    const descriptor = createMemoryFileSystemAdapter(factories.memory);
    expect(
      await createFileSystem({ type: "memory" }, { registry: new Map([["memory", descriptor]]) })
    ).toBe(filesystem);
    expect(factories.memory).toHaveBeenCalledOnce();
    expect(factories.real).not.toHaveBeenCalled();
  });

  it("rejects memory options instead of silently interpreting a host root", async () => {
    const registry = new Map([["memory", createMemoryFileSystemAdapter(factories.memory)]]);
    await expect(
      createFileSystem({ type: "memory", options: { root: "/host" } }, { registry })
    ).rejects.toThrow("Unknown memory option: root");
    expect(factories.memory).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { root: "" },
    { root: " " },
    { root: "relative" },
    { root: "/bad\0path" },
    { root: 1 },
    { root: "/host", credentials: "implicit" }
  ])("rejects invalid real options %j before the supplied factory", async (options) => {
    const registry = new Map([["real", createRealFileSystemAdapter(factories.real)]]);
    await expect(createFileSystem({ type: "real", options }, { registry })).rejects.toThrow(
      TypeError
    );
    expect(factories.real).not.toHaveBeenCalled();
  });

  it("passes an explicit absolute host root to the existing real factory", async () => {
    const registry = new Map([["real", createRealFileSystemAdapter(factories.real)]]);
    expect(
      await createFileSystem({ type: "real", options: { root: "/host/data" } }, { registry })
    ).toBe(filesystem);
    expect(factories.real).toHaveBeenCalledExactlyOnceWith({ root: "/host/data" });
  });

  it("extends Node defaults without mutating the caller registry", async () => {
    const custom = {
      validateOptions: vi.fn(),
      create: vi.fn<FileSystemFactory>().mockReturnValue(filesystem)
    };
    const extensions = new Map([["custom", custom]]);
    const registry = createNodeFileSystemAdapterRegistry(extensions);
    expect([...registry.keys()]).toEqual(["memory", "real", "custom"]);
    expect([...extensions.keys()]).toEqual(["custom"]);
    expect(await createFileSystem({ type: "custom" }, { registry })).toBe(filesystem);
    expect(factories.memory).not.toHaveBeenCalled();
    expect(factories.real).not.toHaveBeenCalled();
  });

  it.each(["memory", "real"])(
    "rejects a caller replacement of builtin %s before construction",
    (name) => {
      const create = vi.fn<FileSystemFactory>();
      expect(() =>
        createNodeFileSystemAdapterRegistry(new Map([[name, { validateOptions: vi.fn(), create }]]))
      ).toThrow(`Filesystem adapter already registered: ${name}`);
      expect(create).not.toHaveBeenCalled();
      expect(factories.memory).not.toHaveBeenCalled();
      expect(factories.real).not.toHaveBeenCalled();
    }
  );
});
