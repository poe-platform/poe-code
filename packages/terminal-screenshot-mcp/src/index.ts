import { createServer, defineSchema, Image } from "tiny-stdio-mcp-server";
import { renderTerminalScreenshot } from "@poe-code/terminal-screenshot";

const schema = defineSchema({
  ansiText: { type: "string", description: "ANSI-formatted terminal output to render" },
  padding: { type: "number", description: "Padding in pixels around the content", optional: true },
  window: { type: "boolean", description: "Whether to render a window chrome around the screenshot", optional: true },
});

export function createTerminalScreenshotMcpServer() {
  return createServer({
    name: "terminal-screenshot-mcp",
    version: "0.1.0",
  }).tool(
    "render_terminal_screenshot",
    "Renders ANSI terminal output as a PNG screenshot",
    schema,
    async ({ ansiText, padding, window }) => {
      const buffer = await renderTerminalScreenshot(ansiText, { padding, window });
      return Image.fromBytes(buffer, "image/png");
    }
  );
}
