import { beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { buildContextArgs, detectContext } from "./context.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn()
}));

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
