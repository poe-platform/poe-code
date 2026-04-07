import { beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { detectEngine, isEngineAvailable } from "./engine.js";
import { buildContextArgs, detectContext } from "./context.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn()
}));

// === engine.test.ts ===

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

// === context.test.ts ===

describe("detectContext", () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('returns "colima" for the default running profile', () => {
    vi.mocked(execSync).mockReturnValue(
      '{"name":"default","status":"Running","runtime":"docker"}\n'
    );

    expect(detectContext()).toBe("colima");
  });

  it('returns "colima-myprofile" for a named profile', () => {
    vi.mocked(execSync).mockReturnValue(
      '{"name":"myprofile","status":"Running","runtime":"docker"}\n'
    );

    expect(detectContext()).toBe("colima-myprofile");
  });

  it('uses the profile field when name is missing', () => {
    vi.mocked(execSync).mockReturnValue(
      '{"profile":"myprofile","status":"Running","runtime":"docker"}\n'
    );

    expect(detectContext()).toBe("colima-myprofile");
  });

  it("returns null when colima is not installed", () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("command not found");
    });

    expect(detectContext()).toBeNull();
  });

  it("returns null when no Docker runtime is running", () => {
    vi.mocked(execSync).mockReturnValue(
      '{"name":"default","status":"Stopped","runtime":"docker"}\n' +
        '{"name":"k8s","status":"Running","runtime":"containerd"}\n'
    );

    expect(detectContext()).toBeNull();
  });

  it("returns null when the running Docker profile has no name", () => {
    vi.mocked(execSync).mockReturnValue(
      '{"status":"Running","runtime":"docker"}\n'
    );

    expect(detectContext()).toBeNull();
  });
});

describe("buildContextArgs", () => {
  it("returns docker context args when context is provided", () => {
    expect(buildContextArgs("docker", "colima")).toEqual(["--context", "colima"]);
  });

  it("returns an empty array for podman", () => {
    expect(buildContextArgs("podman", "colima")).toEqual([]);
  });

  it("returns an empty array when context is null", () => {
    expect(buildContextArgs("docker", null)).toEqual([]);
  });

  it("returns an empty array when context is empty", () => {
    expect(buildContextArgs("docker", "")).toEqual([]);
  });
});
