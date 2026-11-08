import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { applyMcpFile, mergeMcpFileContent } from "./mcp-file.js";

describe("MCP file lifecycle", () => {
  it("deep merges and preserves unrelated config", () => {
    expect(JSON.parse(mergeMcpFileContent(
      JSON.stringify({ other: true, mcpServers: { existing: { command: "old" } } }),
      { mcpServers: { added: { command: "new" } } }
    ))).toEqual({
      other: true,
      mcpServers: { existing: { command: "old" }, added: { command: "new" } }
    });
  });

  it("restores an existing file", async () => {
    const volume = Volume.fromJSON({ "/work/.cursor/mcp.json": "{\"other\":true}\n" });
    const fs = createFsFromVolume(volume).promises;
    const restore = await applyMcpFile(
      { relativePath: ".cursor/mcp.json", content: () => ({ mcpServers: { test: { command: "npx" } } }) },
      {}, "/work", fs
    );
    expect(JSON.parse(await fs.readFile("/work/.cursor/mcp.json", "utf8"))).toHaveProperty("mcpServers.test");
    await restore();
    expect(await fs.readFile("/work/.cursor/mcp.json", "utf8")).toBe("{\"other\":true}\n");
  });

  it("removes a newly created file on restore", async () => {
    const volume = new Volume();
    volume.mkdirSync("/work", { recursive: true });
    const fs = createFsFromVolume(volume).promises;
    const restore = await applyMcpFile(
      { relativePath: ".cursor/mcp.json", content: () => ({ mcpServers: {} }) },
      {}, "/work", fs
    );
    await restore();
    await expect(fs.readFile("/work/.cursor/mcp.json", "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects target paths that resolve through a symlink", async () => {
    const volume = new Volume();
    volume.mkdirSync("/work/.cursor", { recursive: true });
    volume.writeFileSync("/outside-mcp.json", "{\"outside\":true}\n");
    volume.symlinkSync("/outside-mcp.json", "/work/.cursor/mcp.json");
    const fs = createFsFromVolume(volume).promises;

    await expect(
      applyMcpFile(
        {
          relativePath: ".cursor/mcp.json",
          content: () => ({ mcpServers: { test: { command: "npx" } } })
        },
        {},
        "/work",
        fs
      )
    ).rejects.toThrow("MCP config path must not contain symbolic links.");
    expect(await fs.readFile("/outside-mcp.json", "utf8")).toBe("{\"outside\":true}\n");
  });

  it("rejects malformed existing JSON", () => {
    expect(() => mergeMcpFileContent("{", {})).toThrow("Unable to parse existing MCP config JSON");
  });
});
