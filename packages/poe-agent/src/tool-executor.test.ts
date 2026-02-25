import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { DefaultToolExecutor, type ToolExecutorFileSystem } from "./tool-executor.js";

function createMemFs(files: Record<string, string> = {}): ToolExecutorFileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as ToolExecutorFileSystem;
}

describe("DefaultToolExecutor", () => {
  it("implements built-in read_file with path allowlisting", async () => {
    const fs = createMemFs({
      "/workspace/project/README.md": "hello",
      "/workspace/secret.txt": "hidden",
    });

    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    await expect(executor.executeTool("read_file", { path: "README.md" })).resolves.toBe("hello");
    await expect(executor.executeTool("read_file", { path: "../secret.txt" })).rejects.toThrow(
      "outside allowed paths",
    );
  });

  it("edit_file str_replace replaces unique match", async () => {
    const fs = createMemFs({
      "/workspace/project/app.ts": "const x = 1;\nconst y = 2;\n",
    });

    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    await expect(
      executor.executeTool("edit_file", {
        command: "str_replace",
        path: "app.ts",
        old_str: "const x = 1;",
        new_str: "const x = 42;",
      }),
    ).resolves.toContain("Edited file");

    await expect(executor.executeTool("read_file", { path: "app.ts" })).resolves.toBe(
      "const x = 42;\nconst y = 2;\n",
    );
  });

  it("edit_file str_replace rejects non-unique matches", async () => {
    const fs = createMemFs({
      "/workspace/project/dup.ts": "foo\nfoo\n",
    });

    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    await expect(
      executor.executeTool("edit_file", {
        command: "str_replace",
        path: "dup.ts",
        old_str: "foo",
        new_str: "bar",
      }),
    ).rejects.toThrow("appears 2 times");
  });

  it("edit_file str_replace rejects missing match", async () => {
    const fs = createMemFs({
      "/workspace/project/app.ts": "const x = 1;\n",
    });

    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    await expect(
      executor.executeTool("edit_file", {
        command: "str_replace",
        path: "app.ts",
        old_str: "not here",
        new_str: "bar",
      }),
    ).rejects.toThrow("old_str not found");
  });

  it("edit_file str_replace enforces path allowlisting", async () => {
    const fs = createMemFs({
      "/workspace/secret.txt": "hidden",
    });

    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    await expect(
      executor.executeTool("edit_file", {
        command: "str_replace",
        path: "../secret.txt",
        old_str: "hidden",
        new_str: "exposed",
      }),
    ).rejects.toThrow("outside allowed paths");
  });

  it("edit_file create creates a new file", async () => {
    const fs = createMemFs();

    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    await expect(
      executor.executeTool("edit_file", {
        command: "create",
        path: "new/file.ts",
        file_text: "hello world",
      }),
    ).resolves.toContain("Created file");

    await expect(executor.executeTool("read_file", { path: "new/file.ts" })).resolves.toBe(
      "hello world",
    );
  });

  it("edit_file create rejects if file already exists", async () => {
    const fs = createMemFs({
      "/workspace/project/existing.ts": "already here",
    });

    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    await expect(
      executor.executeTool("edit_file", {
        command: "create",
        path: "existing.ts",
        file_text: "overwrite?",
      }),
    ).rejects.toThrow("File already exists");
  });

  it("implements built-in list_files", async () => {
    const fs = createMemFs({
      "/workspace/project/a.txt": "A",
      "/workspace/project/b.txt": "B",
    });

    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    await expect(executor.executeTool("list_files", {})).resolves.toBe("a.txt\nb.txt");
  });

  it("implements built-in run_command with injected dependency", async () => {
    const runCommand = vi.fn(async () => "command output");
    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      runCommand,
    });

    await expect(executor.executeTool("run_command", { command: "ls -la" })).resolves.toBe(
      "command output",
    );
    expect(runCommand).toHaveBeenCalledWith("ls -la", "/workspace/project");
  });

  it("implements built-in search_web with injected dependency", async () => {
    const searchWeb = vi.fn(async () => "search result");
    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      searchWeb,
    });

    await expect(executor.executeTool("search_web", { query: "poe code" })).resolves.toBe(
      "search result",
    );
    expect(searchWeb).toHaveBeenCalledWith("poe code");
  });

  it("returns OpenAI-compatible schemas for all built-in tools", () => {
    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
    });

    const tools = executor.getAvailableTools();
    expect(tools).toHaveLength(5);
    expect(tools.map(tool => tool.function.name)).toEqual([
      "read_file",
      "edit_file",
      "list_files",
      "run_command",
      "search_web",
    ]);

    for (const tool of tools) {
      expect(tool.type).toBe("function");
      expect(tool.function.parameters.type).toBe("object");
      expect(tool.function.parameters.properties).toBeTypeOf("object");
    }
  });

  it("throws for unknown tool names", async () => {
    const executor = new DefaultToolExecutor({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
    });

    await expect(executor.executeTool("unknown", {})).rejects.toThrow("Unsupported tool: unknown");
  });
});
