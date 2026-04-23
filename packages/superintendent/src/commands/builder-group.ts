import { S, UserError, defineCommand, defineGroup } from "toolcraft";
import { text } from "@poe-code/design-system";
import { parseSuperintendentDoc } from "../document/parse.js";
import { runBuilder, type BuilderResult } from "../runtime/run-builder.js";

const builderRunParams = S.Object({
  path: S.String({ description: "Path to the superintendent markdown document" })
});

export const builderRunCommand = defineCommand({
  name: "run",
  description: "Run the configured builder agent.",
  positional: ["path"],
  params: builderRunParams,
  scope: ["cli", "mcp", "sdk"],
  handler: async ({ params, fs }) => {
    const content = await readDocument(params.path, fs);
    const document = parseSuperintendentDoc(params.path, content);

    return runBuilder(document, {}, { defaultCwd: process.cwd() });
  },
  render: {
    rich: (result, { logger }) => {
      logger.success("Builder run completed.");
      logger.message(text.section("Summary:"));
      logger.message(result.summary);
      logger.message(text.section("Log:"));
      logger.message(result.log || "(no output)");
    },
    markdown: (result) => renderBuilderMarkdown(result),
    json: (result) => result
  }
});

export const builderGroup = defineGroup({
  name: "builder",
  description: "Builder commands.",
  scope: ["cli", "mcp", "sdk"],
  children: [builderRunCommand]
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

function renderBuilderMarkdown(result: BuilderResult): string {
  const lines = [
    "## Builder result",
    "",
    "### Summary",
    "",
    result.summary,
    "",
    "### Log",
    "",
    "```text",
    result.log,
    "```"
  ];

  return lines.join("\n");
}

function hasCode(error: unknown, code: string): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
