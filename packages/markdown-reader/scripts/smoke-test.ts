import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { McpClient, StdioTransport } from "tiny-mcp-client";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const EXPECTED_TOOL_NAMES = ["approvals__list", "approvals__show", "read", "read_section"];

export function assertExpectedToolNames(names: string[]): void {
  const sortedNames = [...names].sort();
  const namesMatch =
    sortedNames.length === EXPECTED_TOOL_NAMES.length &&
    EXPECTED_TOOL_NAMES.every((name, index) => sortedNames[index] === name);

  if (!namesMatch) {
    throw new Error(`tools/list mismatch. got: ${JSON.stringify(sortedNames)}`);
  }
}

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
    assertExpectedToolNames(names);
    console.log(`✓ tools/list — ${names.join(", ")}`);

    const result = await client.callTool({
      name: "read",
      arguments: { file: "docs/plans/markdown-reader.md" },
    });

    const text = result.content[0];
    if (text?.type !== "text" || !text.text.includes("2.1")) {
      throw new Error(`tools/call response missing TOC: ${JSON.stringify(result)}`);
    }
    console.log("✓ tools/call read — TOC contains 2.1");
  } finally {
    await client.close();
  }

  console.log("\nAll smoke tests passed.");
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;

if (entryPoint === import.meta.url) {
  run().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Smoke test failed:", message);
    process.exitCode = 1;
  });
}
