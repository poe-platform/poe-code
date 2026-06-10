import { S, UserError, defineCommand, defineGroup } from "toolcraft";
import { hasOwnErrorCode } from "../error-codes.js";
import { parseSuperintendentDoc } from "../document/parse.js";
import {
  runAllInspectors,
  runInspector,
  type InspectorResult
} from "../runtime/run-inspector.js";

export type InspectorListItem = {
  name: string;
  agent: string;
  mode?: string;
};

export type InspectorGroupRunners = {
  runInspector?: typeof runInspector;
  runAllInspectors?: typeof runAllInspectors;
};

const inspectorListParams = S.Object({
  path: S.String({ description: "Path to the superintendent markdown document" })
});

const inspectorRunParams = S.Object({
  path: S.String({ description: "Path to the superintendent markdown document" }),
  name: S.Optional(S.String({ description: "Name of the configured inspector to run" })),
  dryRun: S.Optional(S.Boolean({
    description: "Preview inspector runs without launching agents",
    scope: ["cli", "sdk"],
    global: true
  }))
});

export const inspectorListCommand = defineCommand({
  name: "list",
  description: "List configured inspectors from the document.",
  positional: ["path"],
  params: inspectorListParams,
  scope: ["cli", "mcp", "sdk"],
  handler: async ({ params, fs }) => {
    const content = await readDocument(params.path, fs);
    const document = parseSuperintendentDoc(params.path, content);

    return Object.entries(document.frontmatter.inspectors ?? {}).map(([name, config]) => ({
      name,
      agent: config.agent,
      mode: config.mode
    }));
  },
  render: {
    rich: (result, { logger, renderTable, getTheme }) => {
      if (result.length === 0) {
        logger.message("No inspectors configured.");
        return;
      }

      logger.message(
        renderTable({
          theme: getTheme(),
          columns: [
            { name: "name", title: "Name", alignment: "left", maxLen: 32 },
            { name: "agent", title: "Agent", alignment: "left", maxLen: 24 },
            { name: "mode", title: "Mode", alignment: "left", maxLen: 12 }
          ],
          rows: result.map((inspector) => ({
            name: inspector.name,
            agent: inspector.agent,
            mode: inspector.mode ?? ""
          }))
        })
      );
    },
    markdown: (result) => renderInspectorListMarkdown(result),
    json: (result) => result
  }
});

export function createInspectorRunCommand(runners?: InspectorGroupRunners) {
  const runInspectorImpl = runners?.runInspector ?? runInspector;
  const runAllInspectorsImpl = runners?.runAllInspectors ?? runAllInspectors;

  return defineCommand({
    name: "run",
    description: "Run one configured inspector, or all inspectors when no name is provided.",
    positional: ["path", "name"],
    params: inspectorRunParams,
    scope: ["cli", "mcp", "sdk"],
    handler: async ({ params, fs }) => {
      const content = await readDocument(params.path, fs);
      const document = parseSuperintendentDoc(params.path, content);

      const defaultCwd = process.cwd();

      if (params.name === undefined) {
        if (params.dryRun === true) {
          return Object.entries(document.frontmatter.inspectors ?? {}).map(([name, config]) => ({
            name,
            summary: `Would run inspector agent ${config.agent}.`
          }));
        }
        return runAllInspectorsImpl(document, {}, { defaultCwd });
      }

      const config = document.frontmatter.inspectors?.[params.name];

      if (config === undefined) {
        throw new UserError(`Inspector not found: ${params.name}`);
      }

      if (params.dryRun === true) {
        return [{ name: params.name, summary: `Would run inspector agent ${config.agent}.` }];
      }

      return [await runInspectorImpl(params.name, config, document, {}, { defaultCwd })];
    },
    render: {
      rich: (result, { logger }) => {
        if (result.length === 0) {
          logger.message("No inspectors configured.");
          return;
        }

        logger.success(`Completed ${result.length} inspector run${result.length === 1 ? "" : "s"}.`);

        for (const inspector of result) {
          logger.message(`${inspector.name}: ${inspector.summary || "(no output)"}`);
        }
      },
      markdown: (result) => renderInspectorRunMarkdown(result),
      json: (result) => result
    }
  });
}

export const inspectorRunCommand = createInspectorRunCommand();

export function createInspectorGroup(runners?: InspectorGroupRunners) {
  return defineGroup({
    name: "inspector",
    description: "Inspector commands.",
    scope: ["cli", "mcp", "sdk"],
    children: [inspectorListCommand, createInspectorRunCommand(runners)]
  });
}

export const inspectorGroup = createInspectorGroup();

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

function renderInspectorListMarkdown(result: InspectorListItem[]): string {
  const lines = ["## Inspectors", ""];

  if (result.length === 0) {
    lines.push("No inspectors configured.");
    return lines.join("\n");
  }

  for (const inspector of result) {
    lines.push(`- ${inspector.name} (${inspector.agent}${inspector.mode ? `, ${inspector.mode}` : ""})`);
  }

  return lines.join("\n");
}

function renderInspectorRunMarkdown(result: InspectorResult[]): string {
  const lines = ["## Inspector results", ""];

  if (result.length === 0) {
    lines.push("No inspectors configured.");
    return lines.join("\n");
  }

  for (const inspector of result) {
    lines.push(`### ${inspector.name}`, "", inspector.summary, "");
  }

  return lines.slice(0, -1).join("\n");
}

function hasCode(error: unknown, code: string): error is { code: string } {
  return hasOwnErrorCode(error, code);
}
