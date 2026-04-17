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
    vi.unmock("node:child_process");
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
