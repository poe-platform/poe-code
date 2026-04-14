import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// === credentials.test.ts ===

const getFromStore = vi.fn<() => Promise<string | null>>();
const createSecretStoreMock = vi.fn(() => ({
  backend: "file" as const,
  store: {
    get: getFromStore,
    set: vi.fn(),
    delete: vi.fn()
  }
}));

vi.mock("auth-store", () => ({
  createSecretStore: createSecretStoreMock
}));

// === context.test.ts ===

vi.mock("node:child_process", () => ({
  execSync: vi.fn()
}));

describe("credentials", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.POE_API_KEY;
    getFromStore.mockReset();
    getFromStore.mockResolvedValue(null);
    createSecretStoreMock.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns POE_API_KEY from environment", async () => {
    process.env.POE_API_KEY = "env-key";
    const { getApiKey } = await import("./credentials.js");
    await expect(getApiKey()).resolves.toBe("env-key");
    expect(createSecretStoreMock).not.toHaveBeenCalled();
  });

  it("uses POE_API_KEY when present", async () => {
    process.env.POE_API_KEY = "poe-key";
    const { getApiKey } = await import("./credentials.js");
    await expect(getApiKey()).resolves.toBe("poe-key");
    expect(createSecretStoreMock).not.toHaveBeenCalled();
  });

  it("ignores deprecated env key name and reads from auth store", async () => {
    const deprecatedEnvKeyName = ["POE", "CODE", "API", "KEY"].join("_");
    process.env[deprecatedEnvKeyName] = "deprecated-key";
    getFromStore.mockResolvedValue("stored-key");

    const { getApiKey } = await import("./credentials.js");
    await expect(getApiKey()).resolves.toBe("stored-key");
    expect(createSecretStoreMock).toHaveBeenCalledTimes(1);
  });

  it("reads from auth store when env is not set", async () => {
    getFromStore.mockResolvedValue("stored-key");
    const { getApiKey } = await import("./credentials.js");
    await expect(getApiKey()).resolves.toBe("stored-key");
    expect(createSecretStoreMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when no credentials found", async () => {
    const { getApiKey } = await import("./credentials.js");
    await expect(getApiKey()).resolves.toBeNull();
  });

  it("returns null when auth store throws", async () => {
    getFromStore.mockRejectedValue(new Error("store unavailable"));
    const { getApiKey } = await import("./credentials.js");
    await expect(getApiKey()).resolves.toBeNull();
  });

  it("returns trimmed key from auth store", async () => {
    getFromStore.mockResolvedValue("  stored-trimmed  ");
    const { getApiKey } = await import("./credentials.js");
    await expect(getApiKey()).resolves.toBe("stored-trimmed");
  });

  describe("hasApiKey", () => {
    it("returns true when API key exists", async () => {
      process.env.POE_API_KEY = "some-key";
      const { hasApiKey } = await import("./credentials.js");
      await expect(hasApiKey()).resolves.toBe(true);
    });

    it("returns false when no API key", async () => {
      const { hasApiKey } = await import("./credentials.js");
      await expect(hasApiKey()).resolves.toBe(false);
    });
  });
});

describe("resolved context store", () => {
  beforeEach(async () => {
    const { setResolvedContext } = await import("./context.js");
    setResolvedContext(null);
  });

  it("returns null when explicitly set to null", async () => {
    const { getResolvedContext } = await import("./context.js");
    expect(getResolvedContext()).toBeNull();
  });

  it("stores and retrieves context", async () => {
    const { setResolvedContext, getResolvedContext } = await import("./context.js");
    setResolvedContext("colima-test");
    expect(getResolvedContext()).toBe("colima-test");
  });

  it("clears context with null", async () => {
    const { setResolvedContext, getResolvedContext } = await import("./context.js");
    setResolvedContext("colima-test");
    setResolvedContext(null);
    expect(getResolvedContext()).toBeNull();
  });
});

describe("detectRunningContext", () => {
  it("returns context for running docker profile", async () => {
    const { execSync } = await import("node:child_process");
    vi.mocked(execSync).mockReturnValue(
      '{"name":"poe-runner","status":"Running","runtime":"docker"}\n'
    );
    const { detectRunningContext } = await import("./context.js");
    expect(detectRunningContext()).toBe("colima-poe-runner");
  });

  it("returns colima for default running profile", async () => {
    const { execSync } = await import("node:child_process");
    vi.mocked(execSync).mockReturnValue(
      '{"name":"default","status":"Running","runtime":"docker"}\n'
    );
    const { detectRunningContext } = await import("./context.js");
    expect(detectRunningContext()).toBe("colima");
  });

  it("ignores stopped profiles", async () => {
    const { execSync } = await import("node:child_process");
    vi.mocked(execSync).mockReturnValue(
      '{"name":"default","status":"Stopped","runtime":"docker"}\n'
    );
    const { detectRunningContext } = await import("./context.js");
    expect(detectRunningContext()).toBeNull();
  });

  it("ignores non-docker runtimes", async () => {
    const { execSync } = await import("node:child_process");
    vi.mocked(execSync).mockReturnValue(
      '{"name":"k8s","status":"Running","runtime":"containerd"}\n'
    );
    const { detectRunningContext } = await import("./context.js");
    expect(detectRunningContext()).toBeNull();
  });

  it("returns null when colima is not installed", async () => {
    const { execSync } = await import("node:child_process");
    vi.mocked(execSync).mockImplementation(() => { throw new Error("command not found"); });
    const { detectRunningContext } = await import("./context.js");
    expect(detectRunningContext()).toBeNull();
  });

  it("picks first running docker profile from multiple", async () => {
    const { execSync } = await import("node:child_process");
    vi.mocked(execSync).mockReturnValue(
      '{"name":"default","status":"Stopped","runtime":"docker"}\n' +
      '{"name":"test-runner","status":"Running","runtime":"docker"}\n'
    );
    const { detectRunningContext } = await import("./context.js");
    expect(detectRunningContext()).toBe("colima-test-runner");
  });
});

describe("buildContextArgs", () => {
  it("returns context args for docker with context", async () => {
    const { buildContextArgs } = await import("./context.js");
    expect(buildContextArgs("docker", "colima-test")).toEqual(["--context", "colima-test"]);
  });

  it("returns empty array for docker without context", async () => {
    const { buildContextArgs } = await import("./context.js");
    expect(buildContextArgs("docker", null)).toEqual([]);
  });

  it("returns empty array for podman even with context", async () => {
    const { buildContextArgs } = await import("./context.js");
    expect(buildContextArgs("podman", "colima-test")).toEqual([]);
  });
});
