import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { resolveWorkflowPath } from "@poe-code/agent-kit";
import { parseDocument } from "yaml";
import { parseSuperintendentDoc, type SuperintendentDoc } from "../document/parse.js";
import {
  runLoop,
  type AgentRunInput,
  type AgentRunResult,
  type SuperintendentFileSystem
} from "../runtime/loop.js";
import type { WorkflowTransition } from "../runtime/workflow-tool.js";

type SimulationFs = SuperintendentFileSystem;
type SuperintendentRunResult = Awaited<ReturnType<typeof runLoop>>;

type TurnOutput = {
  stdout: string;
  stderr?: string;
  exitCode?: number;
  summary?: string;
  log?: string;
  output?: string;
  text?: string;
  transition?: unknown;
  toolCalls?: unknown;
  sessionResult?: unknown;
};

export type TurnContext = {
  fs: SimulationFs;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  readDoc: () => Promise<SuperintendentDoc>;
};

export type TurnSpec = {
  assertPrompt?: (prompt: string, ctx: TurnContext) => void | Promise<void>;
  fileChanges?: Record<string, string>;
  output: TurnOutput;
};

export type SimulationOptions = {
  docContent: string;
  docPath?: string;
  turns: TurnSpec[];
  files?: Record<string, string>;
  maxRounds?: number;
  signal?: AbortSignal;
};

export type SimulationRun = AgentRunInput;

export type SimulationResult = {
  result: SuperintendentRunResult;
  prompts: string[];
  runs: SimulationRun[];
  fs: SimulationFs;
  readFile: (filePath: string) => Promise<string>;
  readDoc: () => Promise<SuperintendentDoc>;
};

export type SimulationFailureContext = Omit<SimulationResult, "result">;

function createSimulationFs(options: SimulationOptions): {
  fs: SimulationFs;
  docPath: string;
  absoluteDocPath: string;
  cwd: string;
  homeDir: string;
  rawFs: ReturnType<typeof createFsFromVolume>["promises"];
} {
  const cwd = "/repo";
  const homeDir = "/home/test";
  const docPath = options.docPath ?? ".poe-code/superintendent/plans/plan.md";
  const absoluteDocPath = resolveWorkflowPath(docPath, cwd, homeDir);
  const docContent =
    options.maxRounds === undefined
      ? options.docContent
      : writeMaxRounds(absoluteDocPath, options.docContent, options.maxRounds);
  const files: Record<string, string> = {
    [absoluteDocPath]: docContent,
    ...Object.fromEntries(
      Object.entries(options.files ?? {}).map(([filePath, content]) => [
        path.join(cwd, filePath),
        content
      ])
    )
  };
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  const fs: SimulationFs = {
    readFile: (filePath, encoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
    writeFile: async (filePath, content) => {
      await rawFs.mkdir(path.dirname(filePath), { recursive: true });
      await rawFs.writeFile(filePath, content, { encoding: "utf8" });
    },
    readdir: (filePath) => rawFs.readdir(filePath) as Promise<string[]>,
    stat: async (filePath) => {
      const stat = await rawFs.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: Number(stat.mtimeMs)
      };
    },
    mkdir: async (filePath, mkdirOptions) => {
      await rawFs.mkdir(filePath, mkdirOptions);
    },
    rmdir: async (filePath) => {
      await rawFs.rmdir(filePath);
    },
    rename: async (oldPath, newPath) => {
      await rawFs.mkdir(path.dirname(newPath), { recursive: true });
      await rawFs.rename(oldPath, newPath);
    }
  };

  return {
    fs,
    docPath,
    absoluteDocPath,
    cwd,
    homeDir,
    rawFs
  };
}

async function applyFileChanges(
  rawFs: ReturnType<typeof createFsFromVolume>["promises"],
  cwd: string,
  changes: Record<string, string>
): Promise<void> {
  for (const [filePath, content] of Object.entries(changes)) {
    await fsWriteFile(rawFs, path.join(cwd, filePath), content);
  }
}

async function fsWriteFile(
  rawFs: ReturnType<typeof createFsFromVolume>["promises"],
  absolutePath: string,
  content: string
): Promise<void> {
  await rawFs.mkdir(path.dirname(absolutePath), { recursive: true });
  await rawFs.writeFile(absolutePath, content, { encoding: "utf8" });
}

function normalizeAgentResult(output: TurnOutput): AgentRunResult {
  const workflowToolCalls = output.toolCalls ?? readWorkflowToolCallsFromText(output.stdout);

  return {
    stdout: output.stdout,
    stderr: output.stderr ?? "",
    exitCode: output.exitCode ?? 0,
    ...(output.summary ? { summary: output.summary } : {}),
    ...(output.log ? { log: output.log } : {}),
    ...(output.output ? { output: output.output } : {}),
    ...(output.text ? { text: output.text } : {}),
    ...(output.transition !== undefined ? { transition: output.transition } : {}),
    ...(workflowToolCalls !== undefined ? { toolCalls: workflowToolCalls } : {}),
    ...(output.sessionResult !== undefined ? { sessionResult: output.sessionResult } : {})
  };
}

export function successTurn(
  assertPrompt?: TurnSpec["assertPrompt"],
  fileChanges?: Record<string, string>
): TurnSpec {
  return createSuccessfulTurn({
    assertPrompt,
    fileChanges,
    stdout: ""
  });
}

export function failTurn(
  stderr: string,
  assertPrompt?: TurnSpec["assertPrompt"],
  fileChanges?: Record<string, string>
): TurnSpec {
  return {
    ...(assertPrompt ? { assertPrompt } : {}),
    ...(fileChanges ? { fileChanges } : {}),
    output: {
      stdout: "",
      stderr,
      exitCode: 1
    }
  };
}

export function builderTurn(
  fileChanges?: Record<string, string>,
  assertPrompt?: TurnSpec["assertPrompt"]
): TurnSpec {
  return createSuccessfulTurn({
    assertPrompt,
    fileChanges,
    stdout: ""
  });
}

export function inspectorTurn(summary: string, assertPrompt?: TurnSpec["assertPrompt"]): TurnSpec {
  return createSuccessfulTurn({
    assertPrompt,
    stdout: summary
  });
}

export function superintendentTurn(
  transition?: WorkflowTransition,
  fileChanges?: Record<string, string>,
  assertPrompt?: TurnSpec["assertPrompt"]
): TurnSpec {
  return createSuccessfulTurn({
    assertPrompt,
    fileChanges,
    stdout: transition ? formatWorkflowTransition(transition) : ""
  });
}

export function ownerApproveTurn(assertPrompt?: TurnSpec["assertPrompt"]): TurnSpec {
  return createSuccessfulTurn({
    assertPrompt,
    stdout: formatWorkflowTransition({ action: "approve_completion" })
  });
}

export function ownerRejectTurn(
  feedback: string,
  assertPrompt?: TurnSpec["assertPrompt"]
): TurnSpec {
  return createSuccessfulTurn({
    assertPrompt,
    stdout: formatWorkflowTransition({ action: "request_changes", feedback })
  });
}

export function createSuperintendentSimulation(options: SimulationOptions): {
  run: () => Promise<SimulationResult>;
} {
  return {
    async run(): Promise<SimulationResult> {
      const { fs, docPath, absoluteDocPath, cwd, homeDir, rawFs } = createSimulationFs(options);
      const turns = [...options.turns];
      const prompts: string[] = [];
      const runs: SimulationRun[] = [];

      const readFile = async (filePath: string): Promise<string> =>
        fs.readFile(path.join(cwd, filePath), "utf8");
      const writeFile = async (filePath: string, content: string): Promise<void> =>
        fsWriteFile(rawFs, path.join(cwd, filePath), content);
      const readDoc = async (): Promise<SuperintendentDoc> =>
        parseSuperintendentDoc(absoluteDocPath, await fs.readFile(absoluteDocPath, "utf8"));
      const failureContext: SimulationFailureContext = {
        prompts,
        runs,
        fs,
        readFile,
        readDoc
      };

      try {
        const result = await runLoop({
          docPath,
          cwd,
          homeDir,
          ...(options.signal ? { signal: options.signal } : {}),
          fs,
          runAgent: async (input) => {
            const turn = turns.shift();
            if (!turn) {
              throw new Error("Superintendent simulation ran out of turns.");
            }

            prompts.push(input.prompt);
            runs.push(input);

            if (turn.assertPrompt) {
              await turn.assertPrompt(input.prompt, {
                fs,
                readFile,
                writeFile,
                readDoc
              });
            }

            if (turn.fileChanges) {
              await applyFileChanges(rawFs, cwd, turn.fileChanges);
            }

            return normalizeAgentResult(turn.output);
          }
        });

        return {
          result,
          ...failureContext
        };
      } catch (error) {
        throw attachSimulationContext(error, failureContext);
      }
    }
  };
}

function createSuccessfulTurn(options: {
  assertPrompt?: TurnSpec["assertPrompt"];
  fileChanges?: Record<string, string>;
  stdout: string;
}): TurnSpec {
  return {
    ...(options.assertPrompt ? { assertPrompt: options.assertPrompt } : {}),
    ...(options.fileChanges ? { fileChanges: options.fileChanges } : {}),
    output: {
      stdout: options.stdout,
      exitCode: 0
    }
  };
}

function formatWorkflowTransition(transition: WorkflowTransition): string {
  return "workflow.transition(" + JSON.stringify(transition) + ")";
}

function readWorkflowToolCallsFromText(
  stdout: string
): Array<{ name: string; arguments: string }> | undefined {
  for (const line of splitLines(stdout)) {
    const payload = readWorkflowTransitionTextPayload(line.trim());

    if (payload === undefined) {
      continue;
    }

    return [
      {
        name: "workflow.transition",
        arguments: payload
      }
    ];
  }

  return undefined;
}

function readWorkflowTransitionTextPayload(line: string): string | undefined {
  for (const toolName of [
    "workflow.transition",
    "__superintendent_workflow_transition__.workflow.transition",
    "__owner_workflow_transition__.workflow.transition"
  ]) {
    const prefix = toolName + "(";

    if (line.startsWith(prefix) && line.endsWith(")")) {
      return line.slice(prefix.length, -1).trim();
    }
  }

  return undefined;
}

function attachSimulationContext(
  error: unknown,
  context: SimulationFailureContext
): Error & SimulationFailureContext {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  return Object.assign(normalizedError, context);
}

function splitLines(value: string): string[] {
  return value.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function writeMaxRounds(filePath: string, content: string, maxRounds: number): string {
  const parts = splitDocument(filePath, content);
  const frontmatterDocument = parseDocument(parts.frontmatterText);

  if (frontmatterDocument.errors.length > 0) {
    throw new Error(
      filePath + ": invalid YAML frontmatter: " + frontmatterDocument.errors[0].message
    );
  }

  frontmatterDocument.set("max_rounds", maxRounds);

  return [
    parts.bom,
    "---",
    parts.lineBreak,
    formatFrontmatter(frontmatterDocument.toString(), parts.lineBreak),
    parts.frontmatterSuffix,
    parts.body
  ].join("");
}

function splitDocument(
  filePath: string,
  content: string
): {
  bom: string;
  lineBreak: "\n" | "\r\n";
  frontmatterText: string;
  frontmatterSuffix: string;
  body: string;
} {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const normalizedContent = bom ? content.slice(1) : content;
  const lineBreak = readOpeningLineBreak(normalizedContent);

  if (lineBreak === undefined) {
    throw new Error(filePath + ": expected YAML frontmatter delimited by ---");
  }

  const frontmatterStart = 3 + lineBreak.length;
  const closingFenceIndex = findClosingFence(normalizedContent, frontmatterStart, filePath);
  const frontmatterEnd = readFrontmatterEnd(normalizedContent, closingFenceIndex);
  const bodyStart = readBodyStart(normalizedContent, closingFenceIndex + 4);

  return {
    bom,
    lineBreak,
    frontmatterText: normalizedContent.slice(frontmatterStart, frontmatterEnd),
    frontmatterSuffix: normalizedContent.slice(frontmatterEnd, bodyStart),
    body: normalizedContent.slice(bodyStart)
  };
}

function readOpeningLineBreak(content: string): "\n" | "\r\n" | undefined {
  if (!content.startsWith("---")) {
    return undefined;
  }

  const nextCharacter = content[3];
  if (nextCharacter === "\n") {
    return "\n";
  }

  if (nextCharacter === "\r" && content[4] === "\n") {
    return "\r\n";
  }

  return nextCharacter === undefined ? "\n" : undefined;
}

function findClosingFence(content: string, searchFrom: number, filePath: string): number {
  let currentIndex = searchFrom - 1;

  while (currentIndex < content.length) {
    const candidateIndex = content.indexOf("\n---", currentIndex);

    if (candidateIndex === -1) {
      throw new Error(filePath + ": missing YAML frontmatter end delimiter (---)");
    }

    const fenceEnd = candidateIndex + 4;
    const nextCharacter = content[fenceEnd];

    if (nextCharacter === "\n" || nextCharacter === undefined) {
      return candidateIndex;
    }

    if (nextCharacter === "\r" && content[fenceEnd + 1] === "\n") {
      return candidateIndex;
    }

    currentIndex = fenceEnd;
  }

  throw new Error(filePath + ": missing YAML frontmatter end delimiter (---)");
}

function readBodyStart(content: string, bodyStart: number): number {
  const nextCharacter = content[bodyStart];

  if (nextCharacter === "\n") {
    return bodyStart + 1;
  }

  if (nextCharacter === "\r" && content[bodyStart + 1] === "\n") {
    return bodyStart + 2;
  }

  return bodyStart;
}

function readFrontmatterEnd(content: string, closingFenceIndex: number): number {
  return content[closingFenceIndex - 1] === "\r" ? closingFenceIndex - 1 : closingFenceIndex;
}

function formatFrontmatter(serialized: string, lineBreak: "\n" | "\r\n"): string {
  const normalized = serialized.endsWith("\n") ? serialized.slice(0, -1) : serialized;

  if (lineBreak === "\n") {
    return normalized;
  }

  return normalized.replaceAll("\n", lineBreak);
}
