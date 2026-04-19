import path from "node:path";
import process from "node:process";
import { McpClient, StdioTransport } from "tiny-mcp-client";

const ROOT = path.resolve(import.meta.dirname, "../../..");

async function run(): Promise<void> {
  const transport = new StdioTransport({
    command: "npm",
    args: ["run", "dev", "--", "plan", "markdown-reader-mcp"],
    cwd: ROOT,
    env: { ...process.env },
  });

  const client = new McpClient({ clientInfo: { name: "smoke-test", version: "1.0.0" } });

  try {
    await client.connect(transport);
    console.log("✓ initialize — capabilities received");

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    const expected = ["markdown_reader__read", "markdown_reader__read_section"];
    const namesMatch =
      names.length === expected.length && expected.every((n, i) => names[i] === n);

    if (!namesMatch) {
      throw new Error(`tools/list mismatch. got: ${JSON.stringify(names)}`);
    }
    console.log(`✓ tools/list — ${names.join(", ")}`);

    const result = await client.callTool({
      name: "markdown_reader__read",
      arguments: { file: "docs/plans/markdown-reader.md" },
    });

    const text = result.content[0];
    if (text?.type !== "text" || !text.text.includes("2.1")) {
      throw new Error(`tools/call response missing TOC: ${JSON.stringify(result)}`);
    }
    console.log("✓ tools/call markdown_reader__read — TOC contains 2.1");
  } finally {
    await client.close();
  }

  console.log("\nAll smoke tests passed.");
}

run().catch((err) => {
  console.error("Smoke test failed:", err.message);
  process.exitCode = 1;
});
