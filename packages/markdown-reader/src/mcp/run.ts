import { runMCP } from "toolcraft/mcp";
import packageJson from "../../package.json" with { type: "json" };
import { markdownGroup } from "./group.js";

export async function runMarkdownReaderMcp(): Promise<void> {
  await runMCP(markdownGroup, {
    name: "markdown-reader",
    version: packageJson.version
  });
}
