import { beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { detectEngine, isEngineAvailable } from "./engine.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn()
}));

describe("detectEngine", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('returns "docker" when docker is available', () => {
    vi.mocked(execSync).mockImplementation((command) => {
      if (command === "docker --version") {
        return Buffer.from("");
      }

      throw new Error("not found");
    });

    expect(detectEngine()).toBe("docker");
    expect(execSync).toHaveBeenCalledWith("docker --version", {
      stdio: "ignore"
    });
  });

  it('returns "podman" when only podman is available', () => {
    vi.mocked(execSync).mockImplementation((command) => {
      if (command === "podman --version") {
        return Buffer.from("");
      }

      throw new Error("not found");
    });

    expect(detectEngine()).toBe("podman");
    expect(execSync).toHaveBeenNthCalledWith(1, "docker --version", {
      stdio: "ignore"
    });
    expect(execSync).toHaveBeenNthCalledWith(2, "podman --version", {
      stdio: "ignore"
    });
  });

  it("throws a descriptive error when neither engine is available", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found");
    });

    expect(() => detectEngine()).toThrowError(
      "No container engine found. Please install Docker or Podman:\n" +
        "  - Docker Desktop: https://www.docker.com/products/docker-desktop\n" +
        "  - Colima (macOS): brew install colima && colima start\n" +
        "  - Podman: https://podman.io/docs/installation"
    );
  });
});

describe("isEngineAvailable", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it("returns true when the engine CLI is available", () => {
    vi.mocked(execSync).mockReturnValue(Buffer.from(""));

    expect(isEngineAvailable("docker")).toBe(true);
    expect(execSync).toHaveBeenCalledWith("docker --version", {
      stdio: "ignore"
    });
  });

  it("returns false when the engine CLI is unavailable", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("not found");
    });

    expect(isEngineAvailable("podman")).toBe(false);
    expect(execSync).toHaveBeenCalledWith("podman --version", {
      stdio: "ignore"
    });
  });
});
