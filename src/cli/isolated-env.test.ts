import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { resolveIsolatedTargetDirectory } from "./isolated-env.js";
import { createCliEnvironment } from "./environment.js";
import type { ProviderIsolatedEnv } from "./service-registry.js";

describe("resolveIsolatedTargetDirectory", () => {
  const mockIsolated: ProviderIsolatedEnv = {
    agentBinary: "test-agent",
    configProbe: { kind: "isolatedDir" },
    env: {}
  };

  describe("Unix paths", () => {
    beforeEach(() => {
      vi.spyOn(path, "sep", "get").mockReturnValue("/");
      vi.spyOn(path, "join").mockImplementation((...parts) => parts.join("/"));
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("accepts paths under home directory with forward slashes", () => {
      const homeDir = "/home/user";
      const env = createCliEnvironment({ cwd: "/workspace", homeDir });

      const result = resolveIsolatedTargetDirectory({
        targetDirectory: "/home/user/.claude",
        isolated: mockIsolated,
        env,
        providerName: "test-provider"
      });

      expect(result).toBe("/home/user/.poe-code/test-provider/.claude");
    });

    it("rejects paths outside home directory", () => {
      const homeDir = "/home/user";
      const env = createCliEnvironment({ cwd: "/workspace", homeDir });

      expect(() =>
        resolveIsolatedTargetDirectory({
          targetDirectory: "/etc/config",
          isolated: mockIsolated,
          env,
          providerName: "test-provider"
        })
      ).toThrow(
        'Isolated config targets must live under the user\'s home directory (received "/etc/config").'
      );
    });

    it("accepts home directory itself", () => {
      const homeDir = "/home/user";
      const env = createCliEnvironment({ cwd: "/workspace", homeDir });

      const result = resolveIsolatedTargetDirectory({
        targetDirectory: homeDir,
        isolated: mockIsolated,
        env,
        providerName: "test-provider"
      });

      expect(result).toBe("/home/user/.poe-code/test-provider");
    });
  });

  describe("Windows paths", () => {
    beforeEach(() => {
      vi.spyOn(path, "sep", "get").mockReturnValue("\\");
      vi.spyOn(path, "join").mockImplementation((...parts) =>
        parts.join("\\")
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("accepts paths under home directory with backslashes", () => {
      const homeDir = "C:\\Users\\testuser";
      const env = createCliEnvironment({ cwd: "C:\\workspace", homeDir });

      const result = resolveIsolatedTargetDirectory({
        targetDirectory: "C:\\Users\\testuser\\.claude",
        isolated: mockIsolated,
        env,
        providerName: "test-provider"
      });

      expect(result).toBe(
        "C:\\Users\\testuser\\.poe-code\\test-provider\\.claude"
      );
    });

    it("rejects paths outside home directory on Windows", () => {
      const homeDir = "C:\\Users\\testuser";
      const env = createCliEnvironment({ cwd: "C:\\workspace", homeDir });

      expect(() =>
        resolveIsolatedTargetDirectory({
          targetDirectory: "D:\\config",
          isolated: mockIsolated,
          env,
          providerName: "test-provider"
        })
      ).toThrow(
        'Isolated config targets must live under the user\'s home directory (received "D:\\config").'
      );
    });

    it("accepts home directory itself on Windows", () => {
      const homeDir = "C:\\Users\\testuser";
      const env = createCliEnvironment({ cwd: "C:\\workspace", homeDir });

      const result = resolveIsolatedTargetDirectory({
        targetDirectory: homeDir,
        isolated: mockIsolated,
        env,
        providerName: "test-provider"
      });

      expect(result).toBe("C:\\Users\\testuser\\.poe-code\\test-provider");
    });

    it("handles paths with ~ shortcut on Windows", () => {
      const homeDir = "C:\\Users\\testuser";
      const env = createCliEnvironment({ cwd: "C:\\workspace", homeDir });

      const result = resolveIsolatedTargetDirectory({
        targetDirectory: "~\\.claude",
        isolated: mockIsolated,
        env,
        providerName: "test-provider"
      });

      expect(result).toBe(
        "C:\\Users\\testuser\\.poe-code\\test-provider\\.claude"
      );
    });
  });
});
