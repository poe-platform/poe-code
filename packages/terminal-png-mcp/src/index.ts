import { createServer, defineSchema, Image } from "tiny-stdio-mcp-server";
import { renderTerminalPng } from "terminal-png";

const schema = defineSchema({
  ansiText: { type: "string", description: "ANSI-formatted terminal output to render" },
  padding: { type: "number", description: "Padding in pixels around the content", optional: true },
  window: { type: "boolean", description: "Whether to render a window chrome around the screenshot", optional: true },
});

export function createTerminalPngMcpServer() {
  return createServer({
    name: "terminal-png-mcp",
    version: "0.1.0",
  }).tool(
    "render_terminal_png",
    "Renders ANSI terminal output as a PNG image",
    schema,
    async ({ ansiText, padding, window }) => {
      const buffer = await renderTerminalPng(ansiText, { padding, window });
      return Image.fromBytes(buffer, "image/png");
    }
  );
}
