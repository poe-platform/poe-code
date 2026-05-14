import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

describe("workspace manager", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("creates a new workspace under the root", async () => {
    const { ensureWorkspace } = await import("./manager.js");

    await expect(ensureWorkspace("/repo/workspaces", "octo-org/7/412")).resolves.toEqual({
      path: "/repo/workspaces/octo-org_7_412",
      createdNow: true
    });
    expect(vol.existsSync("/repo/workspaces/octo-org_7_412")).toBe(true);
  });

  it("returns createdNow false for an existing workspace", async () => {
    const { ensureWorkspace } = await import("./manager.js");
    vol.mkdirSync("/repo/workspaces/ENG-412", { recursive: true });

    await expect(ensureWorkspace("/repo/workspaces", "ENG-412")).resolves.toEqual({
      path: "/repo/workspaces/ENG-412",
      createdNow: false
    });
  });

  it("rejects path traversal ids", async () => {
    const { ensureWorkspace, removeWorkspace } = await import("./manager.js");

    await expect(ensureWorkspace("/repo/workspaces", "../foo")).rejects.toThrow(
      "workspace id must not contain parent path segments"
    );
    await expect(ensureWorkspace("/repo/workspaces", "foo/../bar")).rejects.toThrow(
      "workspace id must not contain parent path segments"
    );
    await expect(removeWorkspace("/repo/workspaces", "../foo")).rejects.toThrow(
      "workspace id must not contain parent path segments"
    );
  });

  it("rejects absolute path ids", async () => {
    const { ensureWorkspace } = await import("./manager.js");

    await expect(ensureWorkspace("/repo/workspaces", "/tmp/outside")).rejects.toThrow(
      "workspace id must not be an absolute path"
    );
    await expect(ensureWorkspace("/repo/workspaces", "C:\\tmp\\outside")).rejects.toThrow(
      "workspace id must not be an absolute path"
    );
  });

  it("rejects sanitized keys that resolve outside the root", async () => {
    const { ensureWorkspace } = await import("./manager.js");

    await expect(ensureWorkspace("/repo/workspaces", ".")).rejects.toThrow(
      "workspace path escapes root"
    );
  });

  it("rejects empty qualified ids", async () => {
    const { ensureWorkspace, removeWorkspace } = await import("./manager.js");

    await expect(ensureWorkspace("/repo/workspaces", "")).rejects.toThrow(
      "qualifiedId must not be empty"
    );
    await expect(removeWorkspace("/repo/workspaces", "")).rejects.toThrow(
      "qualifiedId must not be empty"
    );
  });

  it("rejects an existing workspace path that is a file", async () => {
    const { ensureWorkspace } = await import("./manager.js");
    vol.mkdirSync("/repo/workspaces", { recursive: true });
    vol.writeFileSync("/repo/workspaces/ENG-412", "not a directory");

    await expect(ensureWorkspace("/repo/workspaces", "ENG-412")).rejects.toThrow(
      "workspace path exists and is not a directory"
    );
  });

  it("removes a workspace by sanitized qualified id", async () => {
    const { removeWorkspace } = await import("./manager.js");
    vol.mkdirSync("/repo/workspaces/octo-org_7_412", { recursive: true });

    await removeWorkspace("/repo/workspaces", "octo-org/7/412");

    expect(vol.existsSync("/repo/workspaces/octo-org_7_412")).toBe(false);
  });

  it("does not fail when removing a missing workspace", async () => {
    const { removeWorkspace } = await import("./manager.js");

    await expect(removeWorkspace("/repo/workspaces", "missing")).resolves.toBeUndefined();
  });

  it("startup cleanup removes only directories whose key matches a terminal task", async () => {
    const { startupTerminalCleanup } = await import("./manager.js");
    vol.mkdirSync("/repo/workspaces/octo-org_7_412", { recursive: true });
    vol.mkdirSync("/repo/workspaces/ENG-412", { recursive: true });
    vol.mkdirSync("/repo/workspaces/ENG-412-extra", { recursive: true });
    vol.mkdirSync("/repo/workspaces/active", { recursive: true });
    vol.writeFileSync("/repo/workspaces/not-a-dir", "keep");

    await expect(
      startupTerminalCleanup("/repo/workspaces", ["octo-org/7/412", "ENG-412", "not-a-dir"])
    ).resolves.toEqual({ removed: 2 });

    expect(vol.existsSync("/repo/workspaces/octo-org_7_412")).toBe(false);
    expect(vol.existsSync("/repo/workspaces/ENG-412")).toBe(false);
    expect(vol.existsSync("/repo/workspaces/ENG-412-extra")).toBe(true);
    expect(vol.existsSync("/repo/workspaces/active")).toBe(true);
    expect(vol.existsSync("/repo/workspaces/not-a-dir")).toBe(true);
  });

  it("startup cleanup is a no-op when the root does not exist", async () => {
    const { startupTerminalCleanup } = await import("./manager.js");

    await expect(startupTerminalCleanup("/repo/missing", ["ENG-412"])).resolves.toEqual({
      removed: 0
    });
  });

  it("startup cleanup rejects a root that exists as a file", async () => {
    const { startupTerminalCleanup } = await import("./manager.js");
    vol.mkdirSync("/repo", { recursive: true });
    vol.writeFileSync("/repo/workspaces", "not a directory");

    await expect(startupTerminalCleanup("/repo/workspaces", ["ENG-412"])).rejects.toThrow(
      "workspace root exists and is not a directory"
    );
  });

  it("startup cleanup rejects terminal ids that are path escapes", async () => {
    const { startupTerminalCleanup } = await import("./manager.js");
    vol.mkdirSync("/repo/workspaces", { recursive: true });

    await expect(startupTerminalCleanup("/repo/workspaces", ["../foo"])).rejects.toThrow(
      "workspace id must not contain parent path segments"
    );
  });
});
