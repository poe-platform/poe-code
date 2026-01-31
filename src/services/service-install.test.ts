import { describe, it, expect, vi } from "vitest";
import {
  runServiceInstall,
  type InstallContext,
  type ServiceInstallDefinition
} from "./service-install.js";
import type { CommandCheck } from "../utils/command-checks.js";

function createMockRunner(
  responses: Record<string, { stdout?: string; stderr?: string; exitCode: number }>
) {
  return vi.fn(async (command: string, args: string[]) => {
    const key = [command, ...args].join(" ");
    const response = responses[key];
    if (!response) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    return {
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      exitCode: response.exitCode
    };
  });
}

function createPassingCheck(): CommandCheck {
  return {
    id: "check-pass",
    async run() {
      // passes by not throwing
    }
  };
}

function createFailingThenPassingCheck(): CommandCheck {
  let called = false;
  return {
    id: "check-fail-then-pass",
    async run() {
      if (!called) {
        called = true;
        throw new Error("Not installed");
      }
    }
  };
}

describe("runServiceInstall", () => {
  describe("platform filtering", () => {
    it("runs only steps matching the current platform", async () => {
      const runCommand = createMockRunner({});
      const logs: string[] = [];

      const definition: ServiceInstallDefinition = {
        id: "test-service",
        summary: "Test Service",
        check: createFailingThenPassingCheck(),
        steps: [
          {
            id: "darwin-step",
            command: "darwin-cmd",
            args: ["arg1"],
            platforms: ["darwin"]
          },
          {
            id: "linux-step",
            command: "linux-cmd",
            args: ["arg1"],
            platforms: ["linux"]
          },
          {
            id: "win32-step",
            command: "win32-cmd",
            args: ["arg1"],
            platforms: ["win32"]
          }
        ]
      };

      const context: InstallContext = {
        isDryRun: false,
        runCommand,
        logger: (msg) => logs.push(msg),
        platform: "darwin"
      };

      await runServiceInstall(definition, context);

      expect(runCommand).toHaveBeenCalledWith("darwin-cmd", ["arg1"]);
      expect(runCommand).not.toHaveBeenCalledWith("linux-cmd", ["arg1"]);
      expect(runCommand).not.toHaveBeenCalledWith("win32-cmd", ["arg1"]);
    });

    it("runs steps without platform restriction on all platforms", async () => {
      const runCommand = createMockRunner({});
      const logs: string[] = [];

      const definition: ServiceInstallDefinition = {
        id: "test-service",
        summary: "Test Service",
        check: createFailingThenPassingCheck(),
        steps: [
          {
            id: "universal-step",
            command: "universal-cmd",
            args: []
          },
          {
            id: "darwin-only-step",
            command: "darwin-cmd",
            args: [],
            platforms: ["darwin"]
          }
        ]
      };

      const context: InstallContext = {
        isDryRun: false,
        runCommand,
        logger: (msg) => logs.push(msg),
        platform: "linux"
      };

      await runServiceInstall(definition, context);

      expect(runCommand).toHaveBeenCalledWith("universal-cmd", []);
      expect(runCommand).not.toHaveBeenCalledWith("darwin-cmd", []);
    });

    it("runs steps matching multiple platforms", async () => {
      const runCommand = createMockRunner({});
      const logs: string[] = [];

      const definition: ServiceInstallDefinition = {
        id: "test-service",
        summary: "Test Service",
        check: createFailingThenPassingCheck(),
        steps: [
          {
            id: "unix-step",
            command: "unix-cmd",
            args: [],
            platforms: ["darwin", "linux"]
          },
          {
            id: "win32-step",
            command: "win32-cmd",
            args: [],
            platforms: ["win32"]
          }
        ]
      };

      const context: InstallContext = {
        isDryRun: false,
        runCommand,
        logger: (msg) => logs.push(msg),
        platform: "linux"
      };

      await runServiceInstall(definition, context);

      expect(runCommand).toHaveBeenCalledWith("unix-cmd", []);
      expect(runCommand).not.toHaveBeenCalledWith("win32-cmd", []);
    });

    it("filters steps correctly in dry run mode", async () => {
      const runCommand = createMockRunner({});
      const logs: string[] = [];

      const definition: ServiceInstallDefinition = {
        id: "test-service",
        summary: "Test Service",
        check: createFailingThenPassingCheck(),
        steps: [
          {
            id: "darwin-step",
            command: "darwin-cmd",
            args: [],
            platforms: ["darwin"]
          },
          {
            id: "linux-step",
            command: "linux-cmd",
            args: [],
            platforms: ["linux"]
          }
        ]
      };

      const context: InstallContext = {
        isDryRun: true,
        runCommand,
        logger: (msg) => logs.push(msg),
        platform: "darwin"
      };

      await runServiceInstall(definition, context);

      expect(logs.some((msg) => msg.includes("darwin-cmd"))).toBe(true);
      expect(logs.some((msg) => msg.includes("linux-cmd"))).toBe(false);
    });
  });

  describe("skips installation when already installed", () => {
    it("does not run steps when check passes", async () => {
      const runCommand = createMockRunner({});
      const logs: string[] = [];

      const definition: ServiceInstallDefinition = {
        id: "test-service",
        summary: "Test Service",
        check: createPassingCheck(),
        steps: [
          {
            id: "install-step",
            command: "install-cmd",
            args: []
          }
        ]
      };

      const context: InstallContext = {
        isDryRun: false,
        runCommand,
        logger: (msg) => logs.push(msg),
        platform: "darwin"
      };

      const result = await runServiceInstall(definition, context);

      expect(result).toBe(false);
      expect(runCommand).not.toHaveBeenCalled();
      expect(logs.some((msg) => msg.includes("already installed"))).toBe(true);
    });
  });
});
