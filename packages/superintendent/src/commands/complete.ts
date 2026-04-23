import { S, UserError, defineCommand } from "toolcraft";
import { setStatusReason, transitionState } from "../document/write.js";

const completeParams = S.Object({
  path: S.String({ description: "Path to the superintendent markdown document" }),
  reason: S.Optional(S.String({ description: "Why the loop was force-completed" }))
});

export const completeCommand = defineCommand({
  name: "complete",
  description: "Manually mark the superintendent loop as completed.",
  positional: ["path"],
  params: completeParams,
  scope: ["cli", "mcp", "sdk"],
  handler: async ({ params, fs }) => {
    const content = await readDocument(params.path, fs);
    const completedContent = transitionState(params.path, content, "completed");
    const updatedContent = setStatusReason(params.path, completedContent, params.reason);

    await fs.writeFile(params.path, updatedContent);

    return {
      path: params.path,
      state: "completed" as const,
      reason: params.reason
    };
  },
  render: {
    rich: (result, { logger }) => {
      logger.success(`Marked ${result.path} as completed.`);

      if (result.reason !== undefined) {
        logger.message(`Reason: ${result.reason}`);
      }
    },
    markdown: (result) =>
      [
        "## Superintendent completion",
        "",
        `- Path: ${result.path}`,
        `- State: ${result.state}`,
        ...(result.reason === undefined ? [] : [`- Reason: ${result.reason}`])
      ].join("\n"),
    json: (result) => result
  }
});

async function readDocument(
  filePath: string,
  fs: { readFile(path: string, encoding?: BufferEncoding): Promise<string> }
): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      throw new UserError(`Superintendent document not found: ${filePath}`);
    }

    throw error;
  }
}

function hasCode(error: unknown, code: string): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
