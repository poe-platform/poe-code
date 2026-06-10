import { vol } from "memfs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

describe("workspace manager", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("creates a new workspace under the root", async () => {
    const { ensureWorkspace } = await import("./manager.js");

    const workspace = await ensureWorkspace("/repo/workspaces", "octo-org/7/412");

    expect(workspace).toEqual({
      path: expect.stringMatching(/^\/repo\/workspaces\/octo-org_7_412-[a-f0-9]{16}$/),
      createdNow: true
    });
    expect(vol.existsSync(workspace.path)).toBe(true);
  });

  it("returns createdNow false for an existing workspace", async () => {
    const { ensureWorkspace } = await import("./manager.js");
    vol.mkdirSync("/repo/workspaces/ENG-412", { recursive: true });

    await expect(ensureWorkspace("/repo/workspaces", "ENG-412")).resolves.toEqual({
      path: "/repo/workspaces/ENG-412",
      createdNow: false
    });
  });

  it("sanitizeWorkspaceKey rejects path escapes and path separator input", async () => {
    const { sanitizeWorkspaceKey } = await import("../runtime/sanitize.js");

    expect(() => sanitizeWorkspaceKey("..")).toThrow(
      "workspace id must not contain parent path segments"
    );
    expect(() => sanitizeWorkspaceKey("../etc")).toThrow(
      "workspace id must not be an absolute path or contain path separators"
    );
    expect(() => sanitizeWorkspaceKey("/tmp/outside")).toThrow(
      "workspace id must not be an absolute path"
    );
    expect(() => sanitizeWorkspaceKey("C:\\tmp\\outside")).toThrow(
      "workspace id must not be an absolute path"
    );
    expect(() => sanitizeWorkspaceKey("foo\0bar")).toThrow(
      "workspace id must not contain NUL bytes"
    );
    expect(() => sanitizeWorkspaceKey("foo\nbar")).toThrow(
      "workspace id must not contain control characters"
    );
    expect(() => sanitizeWorkspaceKey("foo/bar")).toThrow(
      "workspace id must not be an absolute path or contain path separators"
    );
    expect(() => sanitizeWorkspaceKey("foo\\bar")).toThrow(
      "workspace id must not be an absolute path or contain path separators"
    );
  });

  it("hashes and truncates long workspace ids deterministically", async () => {
    const { sanitizeWorkspaceKey } = await import("../runtime/sanitize.js");
    const id = "task-" + "a".repeat(300);

    const first = sanitizeWorkspaceKey(id);
    const second = sanitizeWorkspaceKey(id);

    expect(first).toBe(second);
    expect(first).toHaveLength(255);
    expect(first).toMatch(/^task-a+-[a-f0-9]{16}$/);
  });

  it("keeps unicode workspace ids deterministic and collision-safe", async () => {
    const { ensureWorkspace } = await import("./manager.js");

    const emoji = await ensureWorkspace("/repo/workspaces", "emoji-🚀");
    const cjk = await ensureWorkspace("/repo/workspaces", "任务");
    const rtl = await ensureWorkspace("/repo/workspaces", "مرحبا");

    await expect(ensureWorkspace("/repo/workspaces", "emoji-🚀")).resolves.toEqual({
      path: emoji.path,
      createdNow: false
    });
    await expect(ensureWorkspace("/repo/workspaces", "任务")).resolves.toEqual({
      path: cjk.path,
      createdNow: false
    });
    await expect(ensureWorkspace("/repo/workspaces", "مرحبا")).resolves.toEqual({
      path: rtl.path,
      createdNow: false
    });
    expect(new Set([emoji.path, cjk.path, rtl.path]).size).toBe(3);
    expect(vol.existsSync(emoji.path)).toBe(true);
    expect(vol.existsSync(cjk.path)).toBe(true);
    expect(vol.existsSync(rtl.path)).toBe(true);
  });

  it("keeps distinct workspaces for ids that sanitize to the same base key", async () => {
    const { ensureWorkspace } = await import("./manager.js");

    const colon = await ensureWorkspace("/repo/workspaces", "a:b");
    const question = await ensureWorkspace("/repo/workspaces", "a?b");

    expect(path.basename(colon.path)).toMatch(/^a_b-[a-f0-9]{16}$/);
    expect(path.basename(question.path)).toMatch(/^a_b-[a-f0-9]{16}$/);
    expect(colon.path).not.toBe(question.path);
    expect(vol.existsSync(colon.path)).toBe(true);
    expect(vol.existsSync(question.path)).toBe(true);
  });

  it("creates the workspace root when it is missing", async () => {
    const { ensureWorkspace } = await import("./manager.js");

    await expect(ensureWorkspace("/repo/workspaces", "ENG-412")).resolves.toEqual({
      path: "/repo/workspaces/ENG-412",
      createdNow: true
    });
    expect(vol.existsSync("/repo/workspaces")).toBe(true);
    expect(vol.existsSync("/repo/workspaces/ENG-412")).toBe(true);
  });

  it("surfaces ancestor stat failures that only inherit missing-path codes", async () => {
    const fs = (await import("node:fs/promises")).default;
    const { ensureWorkspace } = await import("./manager.js");
    const statError = new Error("stat failed");
    vi.spyOn(fs, "lstat").mockRejectedValueOnce(statError);

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(ensureWorkspace("/repo/workspaces", "ENG-412")).rejects.toBe(statError);
    });
  });

  it("throws when the workspace root exists as a file", async () => {
    const { ensureWorkspace } = await import("./manager.js");
    vol.mkdirSync("/repo", { recursive: true });
    vol.writeFileSync("/repo/workspaces", "not a directory");

    await expect(ensureWorkspace("/repo/workspaces", "ENG-412")).rejects.toThrow(
      "workspace root exists and is not a directory"
    );
  });

  it("returns an existing workspace directory without rewriting its contents", async () => {
    const { ensureWorkspace } = await import("./manager.js");
    vol.mkdirSync("/repo/workspaces/ENG-412/nested", { recursive: true });
    vol.writeFileSync("/repo/workspaces/ENG-412/nested/notes.txt", "keep me");

    await expect(ensureWorkspace("/repo/workspaces", "ENG-412")).resolves.toEqual({
      path: "/repo/workspaces/ENG-412",
      createdNow: false
    });

    expect(vol.readFileSync("/repo/workspaces/ENG-412/nested/notes.txt", "utf8")).toBe("keep me");
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
    const { ensureWorkspace, removeWorkspace } = await import("./manager.js");
    const workspace = await ensureWorkspace("/repo/workspaces", "octo-org/7/412");

    await removeWorkspace("/repo/workspaces", "octo-org/7/412");

    expect(vol.existsSync(workspace.path)).toBe(false);
  });

  it("removes a workspace recursively", async () => {
    const { removeWorkspace } = await import("./manager.js");
    vol.mkdirSync("/repo/workspaces/ENG-412/nested/deeper", { recursive: true });
    vol.writeFileSync("/repo/workspaces/ENG-412/nested/deeper/file.txt", "delete me");

    await removeWorkspace("/repo/workspaces", "ENG-412");

    expect(vol.existsSync("/repo/workspaces/ENG-412")).toBe(false);
    expect(vol.existsSync("/repo/workspaces/ENG-412/nested/deeper/file.txt")).toBe(false);
  });

  it("surfaces removeWorkspace filesystem errors to the caller", async () => {
    const fs = (await import("node:fs/promises")).default;
    const { removeWorkspace } = await import("./manager.js");
    vol.mkdirSync("/repo/workspaces", { recursive: true });
    const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
    vi.spyOn(fs, "rm").mockRejectedValueOnce(error);

    await expect(removeWorkspace("/repo/workspaces", "ENG-412")).rejects.toThrow(
      "permission denied"
    );
  });

  it("does not fail when removing a missing workspace", async () => {
    const { removeWorkspace } = await import("./manager.js");

    await expect(removeWorkspace("/repo/workspaces", "missing")).resolves.toBeUndefined();
  });

  it("startup cleanup removes only directories whose key matches a terminal task", async () => {
    const { ensureWorkspace, startupTerminalCleanup } = await import("./manager.js");
    const terminal = await ensureWorkspace("/repo/workspaces", "octo-org/7/412");
    vol.mkdirSync("/repo/workspaces/ENG-412", { recursive: true });
    vol.mkdirSync("/repo/workspaces/ENG-412-extra", { recursive: true });
    vol.mkdirSync("/repo/workspaces/active", { recursive: true });
    vol.writeFileSync("/repo/workspaces/not-a-dir", "keep");

    await expect(
      startupTerminalCleanup("/repo/workspaces", ["octo-org/7/412", "ENG-412", "not-a-dir"])
    ).resolves.toEqual({ removed: 2 });

    expect(vol.existsSync(terminal.path)).toBe(false);
    expect(vol.existsSync("/repo/workspaces/ENG-412")).toBe(false);
    expect(vol.existsSync("/repo/workspaces/ENG-412-extra")).toBe(true);
    expect(vol.existsSync("/repo/workspaces/active")).toBe(true);
    expect(vol.existsSync("/repo/workspaces/not-a-dir")).toBe(true);
  });

  it("startup cleanup survives a terminal workspace key that is a file", async () => {
    const { startupTerminalCleanup } = await import("./manager.js");
    vol.mkdirSync("/repo/workspaces", { recursive: true });
    vol.writeFileSync("/repo/workspaces/ENG-412", "corrupt state");

    await expect(startupTerminalCleanup("/repo/workspaces", ["ENG-412"])).resolves.toEqual({
      removed: 0
    });
    expect(vol.readFileSync("/repo/workspaces/ENG-412", "utf8")).toBe("corrupt state");
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

  it("does not allow crafted task ids to resolve outside the workspace root", async () => {
    const { ensureWorkspace } = await import("./manager.js");
    const root = "/repo/workspaces";

    await expect(ensureWorkspace(root, "../etc")).rejects.toThrow(
      "workspace id must not contain parent path segments"
    );
    const workspace = await ensureWorkspace(root, "etc");

    expect(path.resolve(workspace.path).startsWith(path.resolve(root) + path.sep)).toBe(true);
    expect(vol.existsSync("/repo/etc")).toBe(false);
  });

  it("rejects an existing symlinked workspace directory", async () => {
    const { ensureWorkspace } = await import("./manager.js");
    vol.mkdirSync("/repo/workspaces", { recursive: true });
    vol.mkdirSync("/outside/job", { recursive: true });
    vol.symlinkSync("/outside/job", "/repo/workspaces/job");

    await expect(ensureWorkspace("/repo/workspaces", "job")).rejects.toThrow(
      "workspace directory must not be a symbolic link"
    );
  });

  it("rejects a symlinked workspace root during startup cleanup", async () => {
    const { startupTerminalCleanup } = await import("./manager.js");
    vol.mkdirSync("/outside/done", { recursive: true });
    vol.mkdirSync("/repo", { recursive: true });
    vol.symlinkSync("/outside", "/repo/workspaces");

    await expect(startupTerminalCleanup("/repo/workspaces", ["done"])).rejects.toThrow(
      "workspace root must not be a symbolic link"
    );
    expect(vol.existsSync("/outside/done")).toBe(true);
  });

  it("rejects a workspace root below a symlinked ancestor during startup cleanup", async () => {
    const { startupTerminalCleanup } = await import("./manager.js");
    vol.mkdirSync("/outside/workspaces/done", { recursive: true });
    vol.writeFileSync("/outside/workspaces/done/keep.txt", "keep");
    vol.mkdirSync("/repo", { recursive: true });
    vol.symlinkSync("/outside", "/repo/link");

    await expect(startupTerminalCleanup("/repo/link/workspaces", ["done"])).rejects.toThrow(
      "workspace path must not contain symbolic links"
    );
    expect(vol.readFileSync("/outside/workspaces/done/keep.txt", "utf8")).toBe("keep");
  });

  it("rejects a symlinked workspace root during workspace removal", async () => {
    const { removeWorkspace } = await import("./manager.js");
    vol.mkdirSync("/outside/done", { recursive: true });
    vol.writeFileSync("/outside/done/keep.txt", "keep");
    vol.mkdirSync("/repo", { recursive: true });
    vol.symlinkSync("/outside", "/repo/workspaces");

    await expect(removeWorkspace("/repo/workspaces", "done")).rejects.toThrow(
      "workspace root must not be a symbolic link"
    );
    expect(vol.readFileSync("/outside/done/keep.txt", "utf8")).toBe("keep");
  });

  it("rejects a workspace root below a symlinked ancestor during workspace removal", async () => {
    const { removeWorkspace } = await import("./manager.js");
    vol.mkdirSync("/outside/workspaces/done", { recursive: true });
    vol.writeFileSync("/outside/workspaces/done/keep.txt", "keep");
    vol.mkdirSync("/repo", { recursive: true });
    vol.symlinkSync("/outside", "/repo/link");

    await expect(removeWorkspace("/repo/link/workspaces", "done")).rejects.toThrow(
      "workspace path must not contain symbolic links"
    );
    expect(vol.readFileSync("/outside/workspaces/done/keep.txt", "utf8")).toBe("keep");
  });

  it("rejects creating a workspace root below a symlinked ancestor", async () => {
    const { ensureWorkspace } = await import("./manager.js");
    vol.mkdirSync("/outside", { recursive: true });
    vol.mkdirSync("/repo", { recursive: true });
    vol.symlinkSync("/outside", "/repo/link");

    await expect(ensureWorkspace("/repo/link/workspaces", "job")).rejects.toThrow(
      "workspace path must not contain symbolic links"
    );
    expect(vol.existsSync("/outside/workspaces")).toBe(false);
  });
});
