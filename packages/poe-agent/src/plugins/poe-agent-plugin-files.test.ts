import { promisify } from "node:util";
import { Volume, createFsFromVolume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../runtime/types.js";

function createToolContext(signal: AbortSignal): ToolContext {
  return {
    fork: async () => {
      throw new Error("fork is not supported in plugin tests");
    },
    spawn: async () => {
      throw new Error("spawn is not supported in plugin tests");
    },
    signal,
  };
}

type TestTool = {
  name: string;
  call: (args: unknown, ctx: ToolContext) => unknown | Promise<unknown>;
};

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

async function callTool(tools: TestTool[] | undefined, name: string, args: unknown): Promise<unknown> {
  const tool = tools?.find(candidate => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  return tool.call(args, createToolContext(new AbortController().signal));
}

describe("poe-agent-plugin-files", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:child_process");
  });

  it("passes the tool signal to ripgrep", async () => {
    const execFilePromisifiedMock = vi.fn(
      async (_file: string, _args: string[], options?: { signal?: AbortSignal }) => {
        if (options?.signal?.aborted) {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          throw error;
        }

        return {
          stdout: "src/app.ts:1:const value = 1;\n",
          stderr: "",
        };
      },
    );
    const execFileMock = Object.assign(vi.fn(), {
      [promisify.custom]: execFilePromisifiedMock,
    });

    vi.doMock("node:child_process", () => ({
      execFile: execFileMock,
    }));

    const { default: filesPlugin } = await import("./poe-agent-plugin-files.js");
    const fs = createFsFromVolume(
      Volume.fromJSON(
        {
          "/workspace/project/src/app.ts": "const value = 1;\n",
        },
        "/",
      ),
    ).promises;
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });
    const grepTool = plugin.tools?.find(tool => tool.name === "grep");
    const controller = new AbortController();

    controller.abort(new Error("stop"));

    await expect(
      grepTool?.call({ pattern: "value", path: "src" }, createToolContext(controller.signal)),
    ).rejects.toThrow("grep failed: The operation was aborted");

    expect(execFilePromisifiedMock).toHaveBeenCalledWith(
      "rg",
      expect.any(Array),
      expect.objectContaining({
        cwd: "/workspace/project/src",
        maxBuffer: 1024 * 1024,
        signal: controller.signal,
      }),
    );
  });

  it("validates config options with its plugin spec", async () => {
    const { spec: filesPluginSpec } = await import("./poe-agent-plugin-files.js");

    expect(
      filesPluginSpec.parseOptions({
        cwd: "/workspace/project",
        allowedPaths: ["src", "tests"],
      }),
    ).toEqual({
      cwd: "/workspace/project",
      allowedPaths: ["src", "tests"],
    });
    expect(() => filesPluginSpec.parseOptions({ allowedPaths: [1] })).toThrow();
  });

  it("supports line-based read_file offset and limit", async () => {
    const { default: filesPlugin } = await import("./poe-agent-plugin-files.js");
    const fs = createFsFromVolume(
      Volume.fromJSON(
        {
          "/workspace/project/notes.md": "zero\none\ntwo\nthree\n",
        },
        "/",
      ),
    ).promises;
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    await expect(
      callTool(plugin.tools, "read_file", {
        path: "notes.md",
        offset: 1,
        limit: 2,
      }),
    ).resolves.toBe("one\ntwo\n");

    await expect(
      callTool(plugin.tools, "read_file", {
        path: "notes.md",
        offset: 3,
      }),
    ).resolves.toBe("three\n");
  });

  it("supports edit_file replace_all and overwrite", async () => {
    const { default: filesPlugin } = await import("./poe-agent-plugin-files.js");
    const fs = createFsFromVolume(
      Volume.fromJSON(
        {
          "/workspace/project/app.ts": "const value = 1;\nconst value = 1;\n",
        },
        "/",
      ),
    ).promises;
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    await expect(
      callTool(plugin.tools, "edit_file", {
        command: "str_replace",
        path: "app.ts",
        old_str: "const value = 1;",
        new_str: "const value = 2;",
      }),
    ).rejects.toThrow("old_str appears 2 times");

    await expect(
      callTool(plugin.tools, "edit_file", {
        command: "str_replace",
        path: "app.ts",
        old_str: "const value = 1;",
        new_str: "const value = 2;",
        replace_all: true,
      }),
    ).resolves.toBe("Edited file: app.ts");

    await expect(callTool(plugin.tools, "read_file", { path: "app.ts" })).resolves.toBe(
      "const value = 2;\nconst value = 2;\n",
    );

    await expect(
      callTool(plugin.tools, "edit_file", {
        command: "overwrite",
        path: "app.ts",
        file_text: "export const value = 3;\n",
      }),
    ).resolves.toBe("Overwrote file: app.ts");

    await expect(callTool(plugin.tools, "read_file", { path: "app.ts" })).resolves.toBe(
      "export const value = 3;\n",
    );
  });

  it("does not overwrite a file concurrently created during create", async () => {
    const { default: filesPlugin } = await import("./poe-agent-plugin-files.js");
    const filePath = "/workspace/project/src/new.ts";
    const base = createFsFromVolume(Volume.fromJSON({}, "/")).promises;
    let insertConcurrentFile = true;
    const fs = {
      ...base,
      async mkdir(targetPath: string, options?: Parameters<typeof base.mkdir>[1]) {
        await base.mkdir(targetPath, options);
        if (insertConcurrentFile) {
          insertConcurrentFile = false;
          await base.writeFile(filePath, "created by another actor\n", "utf8");
        }
      }
    };
    const plugin = filesPlugin({ cwd: "/workspace/project", fs: fs as never });

    await expect(
      callTool(plugin.tools, "edit_file", {
        command: "create",
        path: "src/new.ts",
        file_text: "created by agent\n"
      })
    ).rejects.toThrow("File already exists");
    await expect(base.readFile(filePath, "utf8")).resolves.toBe("created by another actor\n");
  });

  it("removes a partially written file when create persistence fails", async () => {
    const { default: filesPlugin } = await import("./poe-agent-plugin-files.js");
    const filePath = "/workspace/project/src/new.ts";
    const base = createFsFromVolume(Volume.fromJSON({}, "/")).promises;
    const fs = {
      ...base,
      async writeFile(
        targetPath: string,
        data: Parameters<typeof base.writeFile>[1],
        options?: Parameters<typeof base.writeFile>[2]
      ) {
        if (targetPath === filePath) {
          await base.writeFile(targetPath, "partial\n", options);
          throw new Error("create disk full");
        }

        await base.writeFile(targetPath, data, options);
      }
    };
    const plugin = filesPlugin({ cwd: "/workspace/project", fs: fs as never });

    await expect(
      callTool(plugin.tools, "edit_file", {
        command: "create",
        path: "src/new.ts",
        file_text: "created by agent\n"
      })
    ).rejects.toThrow("create disk full");
    await expect(base.readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves prior content when a str_replace persistence write fails", async () => {
    const { default: filesPlugin } = await import("./poe-agent-plugin-files.js");
    const filePath = "/workspace/project/src/app.ts";
    const originalContent = "export const value = 'old';\n";
    const nextContent = "export const value = 'new';\n";
    const base = createFsFromVolume(Volume.fromJSON({ [filePath]: originalContent }, "/")).promises;
    let temporaryPath: string | undefined;
    const fs = {
      ...base,
      async writeFile(targetPath: string, data: Parameters<typeof base.writeFile>[1], options?: Parameters<typeof base.writeFile>[2]) {
        if (String(data) === nextContent) {
          if (
            targetPath.startsWith("/workspace/project/src/.app.ts.") &&
            targetPath.endsWith(".tmp")
          ) {
            temporaryPath = targetPath;
            await base.writeFile(targetPath, "partial", options);
          }
          throw new Error("write failed");
        }
        await base.writeFile(targetPath, data, options);
      }
    };
    const plugin = filesPlugin({ cwd: "/workspace/project", fs: fs as never });

    await expect(
      callTool(plugin.tools, "edit_file", {
        command: "str_replace",
        path: "src/app.ts",
        old_str: "'old'",
        new_str: "'new'"
      })
    ).rejects.toThrow("write failed");
    await expect(base.readFile(filePath, "utf8")).resolves.toBe(originalContent);
    expect(temporaryPath).toBeDefined();
    await expect(base.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("cleans failed atomic edit temps that only inherit existing-path codes", async () => {
    const { default: filesPlugin } = await import("./poe-agent-plugin-files.js");
    const filePath = "/workspace/project/src/app.ts";
    const originalContent = "export const value = 'old';\n";
    const nextContent = "export const value = 'new';\n";
    const base = createFsFromVolume(Volume.fromJSON({ [filePath]: originalContent }, "/")).promises;
    let temporaryPath: string | undefined;
    const fs = {
      ...base,
      async writeFile(
        targetPath: string,
        data: Parameters<typeof base.writeFile>[1],
        options?: Parameters<typeof base.writeFile>[2]
      ) {
        if (String(data) === nextContent) {
          if (
            targetPath.startsWith("/workspace/project/src/.app.ts.") &&
            targetPath.endsWith(".tmp")
          ) {
            temporaryPath = targetPath;
            await base.writeFile(targetPath, "partial", options);
          }
          throw new Error("write failed");
        }
        await base.writeFile(targetPath, data, options);
      }
    };
    const plugin = filesPlugin({ cwd: "/workspace/project", fs: fs as never });

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(
        callTool(plugin.tools, "edit_file", {
          command: "str_replace",
          path: "src/app.ts",
          old_str: "'old'",
          new_str: "'new'"
        })
      ).rejects.toThrow("write failed");
    });

    await expect(base.readFile(filePath, "utf8")).resolves.toBe(originalContent);
    expect(temporaryPath).toBeDefined();
    await expect(base.readFile(temporaryPath ?? "", "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not remove a colliding atomic edit temp symlink", async () => {
    const { default: filesPlugin } = await import("./poe-agent-plugin-files.js");
    const filePath = "/workspace/project/src/app.ts";
    const outsidePath = "/workspace/outside.tmp";
    const originalContent = "export const value = 'old';\n";
    const volume = Volume.fromJSON({
      [filePath]: originalContent,
      [outsidePath]: "outside-state\n"
    }, "/");
    const base = createFsFromVolume(volume).promises;
    let temporaryPath: string | undefined;
    const fs = {
      ...base,
      async writeFile(
        targetPath: string,
        data: Parameters<typeof base.writeFile>[1],
        options?: Parameters<typeof base.writeFile>[2]
      ) {
        if (
          temporaryPath === undefined &&
          targetPath.startsWith("/workspace/project/src/.app.ts.") &&
          targetPath.endsWith(".tmp")
        ) {
          temporaryPath = targetPath;
          volume.symlinkSync(outsidePath, targetPath);
          expect(options).toEqual({ encoding: "utf8", flag: "wx" });
        }

        await base.writeFile(targetPath, data, options);
      }
    };
    const plugin = filesPlugin({ cwd: "/workspace/project", fs: fs as never });

    await expect(
      callTool(plugin.tools, "edit_file", {
        command: "str_replace",
        path: "src/app.ts",
        old_str: "'old'",
        new_str: "'new'"
      })
    ).rejects.toThrow();

    expect(temporaryPath).toBeDefined();
    expect(volume.readFileSync(outsidePath, "utf8")).toBe("outside-state\n");
    expect(volume.lstatSync(temporaryPath as string).isSymbolicLink()).toBe(true);
    await expect(base.readFile(filePath, "utf8")).resolves.toBe(originalContent);
  });

  it("rejects reads and writes through symlinked allowed descendants", async () => {
    const { default: filesPlugin } = await import("./poe-agent-plugin-files.js");
    const volume = Volume.fromJSON({
      "/workspace/outside/secret.txt": "outside secret\n"
    }, "/");
    volume.mkdirSync("/workspace/project", { recursive: true });
    volume.symlinkSync("/workspace/outside", "/workspace/project/linked");
    const fs = createFsFromVolume(volume).promises;
    const plugin = filesPlugin({ cwd: "/workspace/project", fs });

    await expect(callTool(plugin.tools, "read_file", { path: "linked/secret.txt" })).rejects.toThrow(
      "Path may not contain symbolic links"
    );
    await expect(
      callTool(plugin.tools, "edit_file", {
        command: "overwrite",
        path: "linked/new.txt",
        file_text: "written outside\n"
      })
    ).rejects.toThrow("Path may not contain symbolic links");
    expect(volume.existsSync("/workspace/outside/new.txt")).toBe(false);
  });

  it("returns image tool results for image files", async () => {
    const { default: filesPlugin } = await import("./poe-agent-plugin-files.js");
    const volume = Volume.fromJSON({}, "/");
    volume.mkdirSync("/workspace/project", { recursive: true });
    volume.writeFileSync("/workspace/project/diagram.png", Buffer.from("png-binary"));
    const fs = createFsFromVolume(volume).promises;
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    await expect(callTool(plugin.tools, "read_file", { path: "diagram.png" })).resolves.toEqual({
      type: "image",
      mimeType: "image/png",
      data: Buffer.from("png-binary").toString("base64"),
    });
  });

  it("returns glob matches sorted by modified time descending", async () => {
    const { default: filesPlugin } = await import("./poe-agent-plugin-files.js");
    const volume = Volume.fromJSON(
      {
        "/workspace/project/src/alpha.ts": "export const alpha = 1;\n",
        "/workspace/project/src/beta.ts": "export const beta = 2;\n",
      },
      "/",
    );
    volume.utimesSync("/workspace/project/src/alpha.ts", new Date(1_000), new Date(1_000));
    volume.utimesSync("/workspace/project/src/beta.ts", new Date(2_000), new Date(2_000));

    const fs = createFsFromVolume(volume).promises;
    const globFiles = vi.fn(async () => [
      "/workspace/project/src/alpha.ts",
      "/workspace/project/src/beta.ts",
    ]);
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
      globFiles,
    });

    await expect(
      callTool(plugin.tools, "glob", {
        pattern: "**/*.ts",
        path: "src",
      }),
    ).resolves.toBe("src/beta.ts\nsrc/alpha.ts");
  });
});
