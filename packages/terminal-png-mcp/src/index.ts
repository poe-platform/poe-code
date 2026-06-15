import { createServer, Image, type TypedSchema } from "tiny-stdio-mcp-server";
import { renderTerminalPng } from "terminal-png";

interface RenderTerminalPngArgs {
  ansiText: string;
  padding?: number;
  window?: boolean;
}

const schema: TypedSchema<RenderTerminalPngArgs> = {
  type: "object",
  properties: {
    ansiText: {
      type: "string",
      description: "ANSI-formatted terminal output to render"
    },
    padding: {
      type: "integer",
      minimum: 0,
      description: "Padding in pixels around the content"
    },
    window: {
      type: "boolean",
      description: "Whether to render a window chrome around the screenshot"
    }
  },
  required: ["ansiText"]
};

export function createTerminalPngMcpServer() {
  return createServer({
    name: "terminal-png-mcp",
    version: "0.1.0"
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
