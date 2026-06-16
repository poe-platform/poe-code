import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import memoryPlugin, { spec as memoryPluginSpec } from "./poe-agent-plugin-memory.js";

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

describe("poe-agent-plugin-memory", () => {
  it("validates config options with its plugin spec", () => {
    expect(
      memoryPluginSpec.parseOptions({
        cwd: "/workspace/project",
        homeDir: "/home/test",
      }),
    ).toEqual({
      cwd: "/workspace/project",
      homeDir: "/home/test",
    });
    expect(() => memoryPluginSpec.parseOptions({ homeDir: 123 })).toThrow();
  });

  it("loads project and user AGENTS.md content with recursive @imports", async () => {
    const volume = Volume.fromJSON(
      {
        "/workspace/AGENTS.md": "Workspace memory",
        "/workspace/project/AGENTS.md": "Project instructions\n@./docs/shared.md",
        "/workspace/project/docs/shared.md": "Shared rules\n@./nested.md",
        "/workspace/project/docs/nested.md": "No TODOs.",
        "/home/test/.config/poe-code/AGENTS.md": "User instructions\n@profiles/base.md",
        "/home/test/.config/poe-code/profiles/base.md": "Be concise.",
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises;
    const plugin = memoryPlugin({
      cwd: "/workspace/project/src/feature",
      homeDir: "/home/test",
      fs,
    });

    const transformed = await plugin.prompt?.({
      userPrompt: "Fix the tests",
      system: "base-system",
    });

    expect(transformed?.system).toBe(
      [
        "Project memory:",
        "Project instructions",
        "Shared rules",
        "No TODOs.",
        "",
        "User memory:",
        "User instructions",
        "Be concise.",
        "",
        "base-system",
      ].join("\n"),
    );
  });

  it("preserves leading @handle memory lines as text", async () => {
    const volume = Volume.fromJSON(
      {
        "/workspace/project/AGENTS.md": "@alice owns releases.\nKeep edits focused.\n",
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises;
    const plugin = memoryPlugin({
      cwd: "/workspace/project",
      homeDir: "/home/test",
      fs,
    });

    const transformed = await plugin.prompt?.({
      userPrompt: "Fix the tests",
      system: "base-system",
    });

    expect(transformed?.system).toBe(
      "Project memory:\n@alice owns releases.\nKeep edits focused.\n\nbase-system",
    );
  });

  it("rejects project imports that escape the containing AGENTS directory", async () => {
    const volume = Volume.fromJSON(
      {
        "/workspace/project/AGENTS.md": "@../outside.md",
        "/workspace/outside.md": "External instructions",
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises;
    const plugin = memoryPlugin({
      cwd: "/workspace/project",
      homeDir: "/home/test",
      fs,
    });

    await expect(
      plugin.prompt?.({ userPrompt: "Fix the tests", system: "base-system" }),
    ).rejects.toThrow("AGENTS.md import escapes its trusted directory");
  });

  it("rejects symlinked project and user AGENTS files", async () => {
    const volume = Volume.fromJSON(
      {
        "/outside/project.md": "External project instructions",
        "/outside/user.md": "External user instructions",
      },
      "/",
    );
    await volume.promises.mkdir("/workspace/project", { recursive: true });
    await volume.promises.mkdir("/home/test/.config/poe-code", { recursive: true });
    await volume.promises.symlink("/outside/project.md", "/workspace/project/AGENTS.md");
    await volume.promises.symlink("/outside/user.md", "/home/test/.config/poe-code/AGENTS.md");
    const fs = createFsFromVolume(volume).promises;
    const plugin = memoryPlugin({
      cwd: "/workspace/project",
      homeDir: "/home/test",
      fs,
    });

    await expect(
      plugin.prompt?.({ userPrompt: "Fix the tests", system: "base-system" }),
    ).rejects.toThrow("AGENTS.md file escapes its trusted directory");
  });

  it("prefers the nearest AGENTS.md when walking up from cwd", async () => {
    const volume = Volume.fromJSON(
      {
        "/workspace/AGENTS.md": "Workspace memory",
        "/workspace/project/AGENTS.md": "Project memory",
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises;
    const plugin = memoryPlugin({
      cwd: "/workspace/project/packages/poe-agent",
      homeDir: "/home/test",
      fs,
    });

    const transformed = await plugin.prompt?.({
      userPrompt: "Fix the tests",
      system: "base-system",
    });

    expect(transformed?.system).toBe("Project memory:\nProject memory\n\nbase-system");
  });

  it("leaves the prompt unchanged when no AGENTS.md files exist", async () => {
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    const plugin = memoryPlugin({
      cwd: "/workspace/project",
      homeDir: "/home/test",
      fs,
    });
    const context = {
      userPrompt: "Fix the tests",
      system: "base-system",
    };

    await expect(plugin.prompt?.(context)).resolves.toEqual(context);
  });

  it("does not treat inherited lstat codes as missing AGENTS files", async () => {
    const base = createFsFromVolume(
      Volume.fromJSON({ "/workspace/project/AGENTS.md": "Project memory" }, "/"),
    ).promises;
    const lstatError = new Error("lstat denied");
    const fs = {
      ...base,
      async lstat(filePath: string) {
        if (filePath === "/workspace/project/AGENTS.md") {
          throw lstatError;
        }
        return base.lstat(filePath);
      },
    };
    const plugin = memoryPlugin({
      cwd: "/workspace/project",
      homeDir: "/home/test",
      fs,
    });

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(plugin.prompt?.({ userPrompt: "Fix", system: "base" })).rejects.toBe(
        lstatError,
      );
    });
  });
});
