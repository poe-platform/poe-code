import path from "node:path";
import { S, UserError, defineCommand, defineGroup } from "toolcraft";
import { text } from "toolcraft-design";
import { hasOwnErrorCode } from "../error-codes.js";
import {
  parseSuperintendentDoc,
  resolveSuperintendentDoc,
  type SuperintendentDoc,
  type SuperintendentDocumentFileSystem
} from "../document/parse.js";
import { hasTaskBoard, parseTaskBoard } from "../document/tasks.js";
import {
  builderGroup,
  createBuilderGroup,
  type BuilderGroupRunners
} from "./builder-group.js";
import { completeCommand } from "./complete.js";
import { installCommand } from "./install.js";
import {
  inspectorGroup,
  createInspectorGroup,
  type InspectorGroupRunners
} from "./inspector-group.js";
import { planPathCommand } from "./plan-path.js";
import {
  runCommand,
  createRunMcpCommand,
  type RunMcpCommandRunners
} from "./run.js";

export type ValidationProblem = {
  level: "error" | "warning";
  message: string;
};

export type ValidationResult = {
  valid: boolean;
  problems: ValidationProblem[];
  extends?: string;
  merged?: string[];
};

const validateParams = S.Object({
  path: S.String({ description: "Path to the superintendent markdown document" })
});

export const validateCommand = defineCommand({
  name: "validate",
  description: "Validate a superintendent markdown document.",
  positional: ["path"],
  params: validateParams,
  scope: ["cli", "mcp", "sdk"],
  handler: async ({ params, fs }) => {
    const content = await readDocument(params.path, fs);
    return validateSuperintendentDocumentWithExtends(params.path, content, fs);
  },
  render: {
    rich: (result, { logger }) => {
      const errors = result.problems.filter((problem) => problem.level === "error");
      const warnings = result.problems.filter((problem) => problem.level === "warning");

      if (result.valid) {
        logger.success("Superintendent document is valid.");
      } else {
        logger.error(
          `Superintendent document is invalid (${errors.length} error${errors.length === 1 ? "" : "s"}).`
        );
      }

      if (warnings.length > 0) {
        logger.warn(`${warnings.length} warning${warnings.length === 1 ? "" : "s"} found.`);
      }

      if (result.extends !== undefined) {
        logger.message(`extends: ${result.extends}`);
      }

      if (result.merged !== undefined) {
        logger.message(`merged: ${result.merged.join(", ")}`);
      }

      if (result.problems.length === 0) {
        return;
      }

      logger.message(text.section("Problems:"));

      for (const problem of result.problems) {
        logger.message(`- ${capitalize(problem.level)}: ${problem.message}`);
      }
    },
    markdown: (result) => renderValidationMarkdown(result),
    json: (result) => result
  }
});

export const superintendentGroup = defineGroup({
  name: "superintendent",
  description: "Superintendent workflow commands.",
  scope: ["cli", "mcp", "sdk"],
  children: [runCommand, validateCommand, completeCommand, installCommand, planPathCommand, builderGroup, inspectorGroup]
});

export type SuperintendentMcpGroupRunners =
  RunMcpCommandRunners & BuilderGroupRunners & InspectorGroupRunners;

export function createSuperintendentMcpGroup(runners?: SuperintendentMcpGroupRunners) {
  return defineGroup({
    name: "superintendent",
    description: "Superintendent workflow commands.",
    scope: ["mcp"],
    children: [
      createRunMcpCommand(runners),
      validateCommand,
      completeCommand,
      createBuilderGroup(runners),
      createInspectorGroup(runners)
    ]
  });
}

export const superintendentMcpGroup = createSuperintendentMcpGroup();

export function validateSuperintendentDocument(
  filePath: string,
  content: string
): ValidationResult {
  try {
    return validateResolvedSuperintendentDocument(parseSuperintendentDoc(filePath, content));
  } catch (error) {
    return toValidationResult([
      {
        level: "error",
        message: readErrorMessage(error)
      }
    ]);
  }
}

export async function validateSuperintendentDocumentWithExtends(
  filePath: string,
  content: string,
  fs: SuperintendentDocumentFileSystem
): Promise<ValidationResult> {
  try {
    const resolved = await resolveSuperintendentDoc(filePath, content, fs);
    return validateResolvedSuperintendentDocument(
      resolved.document,
      resolved.extendsPath === undefined
        ? undefined
        : {
            extends: formatDisplayPath(resolved.extendsPath),
            merged: summarizeMergedFrontmatter(resolved.document)
          }
    );
  } catch (error) {
    if (error instanceof UserError) {
      throw error;
    }

    return toValidationResult([
      {
        level: "error",
        message: readErrorMessage(error)
      }
    ]);
  }
}

type ValidationMetadata = Pick<ValidationResult, "extends" | "merged">;

function validateResolvedSuperintendentDocument(
  document: SuperintendentDoc,
  metadata?: ValidationMetadata
): ValidationResult {
  const problems: ValidationProblem[] = [];
  if (!hasTaskBoard(document.body)) {
    problems.push({
      level: "error",
      message: 'Missing "## Task Board" section'
    });
  } else {
    try {
      const taskBoard = parseTaskBoard(document.body);

      if (taskBoard.tasks.length === 0) {
        problems.push({
          level: "error",
          message: "Task Board must contain markdown checkbox items"
        });
      }
    } catch (error) {
      problems.push({
        level: "error",
        message: readErrorMessage(error)
      });
    }
  }

  problems.push(...validatePromptVariables(document));

  return {
    ...toValidationResult(problems),
    ...metadata
  };
}

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

function validatePromptVariables(document: SuperintendentDoc): ValidationProblem[] {
  const allowedVariables = new Set<string>([
    "plan.path",
    "builder.summary",
    "builder.log",
    "builder.log_path",
    "superintendent.summary",
    "superintendent.log_path",
    "owner.feedback",
    "owner.log_path"
  ]);

  for (const inspectorName of Object.keys(document.frontmatter.inspectors ?? {})) {
    allowedVariables.add(`inspectors.${inspectorName}`);
    allowedVariables.add(`inspector_logs.${inspectorName}`);
  }

  const problems: ValidationProblem[] = [];

  for (const prompt of collectPrompts(document)) {
    const seenUnknownVariables = new Set<string>();

    for (const variableName of scanPromptVariables(prompt.value)) {
      if (allowedVariables.has(variableName) || seenUnknownVariables.has(variableName)) {
        continue;
      }

      seenUnknownVariables.add(variableName);
      problems.push({
        level: "warning",
        message: `Unknown prompt variable "${variableName}" in ${prompt.path}`
      });
    }
  }

  return problems;
}

function collectPrompts(document: SuperintendentDoc): Array<{ path: string; value: string }> {
  const prompts = [
    { path: "builder.prompt", value: document.frontmatter.builder.prompt },
    {
      path: "superintendent.prompt",
      value: document.frontmatter.superintendent.prompt
    },
    { path: "owner.prompt", value: document.frontmatter.owner.prompt }
  ];

  for (const [name, inspector] of Object.entries(document.frontmatter.inspectors ?? {})) {
    prompts.push({
      path: `inspectors.${name}.prompt`,
      value: inspector.prompt
    });
  }

  return prompts;
}

function summarizeMergedFrontmatter(document: SuperintendentDoc): string[] {
  const summary = ["builder"];
  const inspectorNames = Object.keys(document.frontmatter.inspectors ?? {}).sort();

  if (inspectorNames.length > 0) {
    summary.push(`inspectors (${inspectorNames.join(", ")})`);
  }

  summary.push("superintendent", "owner", "max_rounds", "status");
  return summary;
}

function formatDisplayPath(filePath: string): string {
  const relativePath = path.relative(process.cwd(), filePath);

  if (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  ) {
    return relativePath;
  }

  return filePath;
}

function scanPromptVariables(prompt: string): string[] {
  const variables: string[] = [];
  let index = 0;

  while (index < prompt.length) {
    const opening = prompt.indexOf("{{", index);

    if (opening === -1) {
      break;
    }

    const triple = prompt[opening + 2] === "{";
    const closing = prompt.indexOf(triple ? "}}}" : "}}", opening + (triple ? 3 : 2));

    if (closing === -1) {
      break;
    }

    const rawToken = prompt.slice(opening + (triple ? 3 : 2), closing);
    const variableName = normalizeTemplateToken(rawToken);

    if (variableName !== undefined) {
      variables.push(variableName);
    }

    index = closing + (triple ? 3 : 2);
  }

  return variables;
}

function normalizeTemplateToken(token: string): string | undefined {
  const trimmed = token.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const prefix = trimmed[0];

  if (
    prefix === undefined ||
    prefix === "!" ||
    prefix === "#" ||
    prefix === "/" ||
    prefix === ">" ||
    prefix === "^" ||
    prefix === "&"
  ) {
    return undefined;
  }

  return trimmed;
}

function toValidationResult(problems: ValidationProblem[]): ValidationResult {
  return {
    valid: !problems.some((problem) => problem.level === "error"),
    problems
  };
}

function renderValidationMarkdown(result: ValidationResult): string {
  const lines = [
    "## Validation result",
    "",
    `- Status: ${result.valid ? "valid" : "invalid"}`,
    `- Problems: ${result.problems.length}`
  ];

  if (result.extends !== undefined) {
    lines.push(`- Extends: ${result.extends}`);
  }

  if (result.merged !== undefined) {
    lines.push(`- Merged: ${result.merged.join(", ")}`);
  }

  if (result.problems.length === 0) {
    return lines.join("\n");
  }

  lines.push("", "### Problems", "");

  for (const problem of result.problems) {
    lines.push(`- **${capitalize(problem.level)}:** ${problem.message}`);
  }

  return lines.join("\n");
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, code);
}

function capitalize(value: string): string {
  const firstCharacter = value[0] ?? "";
  return `${firstCharacter.toUpperCase()}${value.slice(1)}`;
}
