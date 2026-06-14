import { S, UserError, defineCommand, defineGroup } from "toolcraft";
import { text } from "toolcraft-design";
import { hasOwnErrorCode } from "../error-codes.js";
import { resolveSuperintendentDoc } from "../document/parse.js";
import { runBuilder, type BuilderResult } from "../runtime/run-builder.js";

export type BuilderGroupRunners = {
  runBuilder?: typeof runBuilder;
};

const builderRunParams = S.Object({
  path: S.String({ description: "Path to the superintendent markdown document" }),
  dryRun: S.Optional(S.Boolean({
    description: "Preview the builder run without launching an agent",
    scope: ["cli", "sdk"],
    global: true
  }))
});

export function createBuilderRunCommand(runners?: BuilderGroupRunners) {
  const runBuilderImpl = runners?.runBuilder ?? runBuilder;

  return defineCommand({
    name: "run",
    description: "Run the configured builder agent.",
    positional: ["path"],
    params: builderRunParams,
    scope: ["cli", "mcp", "sdk"],
    handler: async ({ params, fs }) => {
      const content = await readDocument(params.path, fs);
      const { document } = await resolveSuperintendentDoc(
        params.path,
        content,
        fs
      );

      if (params.dryRun === true) {
        return {
          summary: `Would run builder agent ${document.frontmatter.builder.agent}.`,
          log: document.frontmatter.builder.prompt,
          log_path: ""
        };
      }

      return runBuilderImpl(document, {}, { defaultCwd: process.cwd() });
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
}

export const builderRunCommand = createBuilderRunCommand();

export function createBuilderGroup(runners?: BuilderGroupRunners) {
  return defineGroup({
    name: "builder",
    description: "Builder commands.",
    scope: ["cli", "mcp", "sdk"],
    children: [createBuilderRunCommand(runners)]
  });
}

export const builderGroup = createBuilderGroup();

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
  return hasOwnErrorCode(error, code);
}
