import path from "node:path";
import * as fsPromises from "node:fs/promises";
import {
  makeRunLogFileName,
  resolveRunLogDir,
  resolveWorkflowPath,
  runDocumentWorkflow
} from "@poe-code/agent-harness-tools";
import {
  formatAgentSpecifier,
  parseAgentSpecifier,
  type AgentSpecifier
} from "@poe-code/agent-defs";
import { resolve } from "@poe-code/config-extends";
import {
  parseFrontmatter,
  parseFrontmatterData,
  writeFrontmatter,
  type RalphPlanStatus
} from "../frontmatter/frontmatter.js";
import type {
  RalphFileStat,
  RalphFileSystem,
  RalphRunOptions,
  RalphRunResult
} from "../types.js";
import { interpolateVariables } from "../variables/variables.js";

type LockCapableRalphFs = {
  open(path: string, flags: string): Promise<{
    close(): Promise<void>;
    writeFile(
      data: string,
      options?: BufferEncoding | { encoding?: BufferEncoding }
    ): Promise<void>;
  }>;
  stat(path: string): Promise<{
    mtimeMs: number;
  }>;
  unlink(path: string): Promise<void>;
};

class RalphWorkflowStopError extends Error {
  constructor(readonly kind: "failed" | "cancelled" | "fatal") {
    super(`Ralph workflow stopped: ${kind}`);
    this.name = "RalphWorkflowStopError";
  }
}

export async function runRalph(
  options: RalphRunOptions
): Promise<RalphRunResult> {
  const fs = options.fs ?? createDefaultFs();
  const runAgent = options.runAgent;
  if (!runAgent) {
    throw new Error("runRalph requires a runAgent implementation.");
  }

  const absoluteDocPath = resolveWorkflowPath(
    options.docPath,
    options.cwd,
    options.homeDir
  );
  const runLogDir = resolveRunLogDir({
    planPath: absoluteDocPath,
    runner: "ralph",
    homeDir: options.homeDir
  });
  const config = await resolveDocumentConfig(options, fs, absoluteDocPath);
  const startTime = Date.now();
  let iterationsCompleted = 0;
  let currentIterationStart = 0;
  let stopReason: RalphRunResult["stopReason"] = "max_iterations";
  let archived = false;
  let fatalError: unknown;
  let lastStopKind: RalphWorkflowStopError["kind"] | null = null;

  if (options.signal?.aborted) {
    await updateFrontmatter(fs, absoluteDocPath, "open", 0);
    return createRunResult(options.docPath, startTime, 0, "cancelled");
  }

  try {
    await runDocumentWorkflow({
      cwd: options.cwd,
      homeDir: options.homeDir,
      docPath: absoluteDocPath,
      fs,
      signal: options.signal,
      readConfig: async (content) => {
        const fresh = await resolveDocumentConfigFromContent(
          options,
          fs,
          absoluteDocPath,
          content
        );
        return {
          frontmatter: createWorkflowFrontmatter(
            fresh.agents,
            fresh.maxIterations,
            fresh.prompt
          ),
          body: fresh.prompt
        };
      },
      runAgent: async (input) => {
        const specifier = parseAgentSpecifier(input.agent);

        try {
          const result = await runAgent({
            agent: specifier.agent,
            prompt: input.prompt,
            cwd: input.cwd,
            logDir: runLogDir,
            logFileName: makeRunLogFileName(specifier.agent),
            ...(specifier.model ?? input.model
              ? { model: specifier.model ?? input.model }
              : {}),
            ...(input.signal ? { signal: input.signal } : {})
          });

          if (result.exitCode !== 0) {
            lastStopKind = "failed";
            throw new RalphWorkflowStopError("failed");
          }

          lastStopKind = null;
          return result;
        } catch (error) {
          if (error instanceof RalphWorkflowStopError) {
            throw error;
          }

          if (isAbortError(error)) {
            lastStopKind = "cancelled";
            throw new RalphWorkflowStopError("cancelled");
          }

          lastStopKind = "fatal";
          fatalError = error;
          throw new RalphWorkflowStopError("fatal");
        }
      },
      onIterationStart: async (iteration) => {
        currentIterationStart = Date.now();

        if (iteration === 0) {
          await updateFrontmatter(fs, absoluteDocPath, "in_progress", 0);
        }

        const currentSpecifier = config.agents[iteration % config.agents.length]!;
        options.onIterationStart?.(
          iteration + 1,
          config.maxIterations,
          currentSpecifier.agent
        );
      },
      onIterationEnd: async (iteration, result) => {
        const iterationNumber = iteration + 1;
        const durationMs = Date.now() - currentIterationStart;

        if (result === "failed") {
          if (lastStopKind === "failed") {
            iterationsCompleted = iterationNumber;
            stopReason = "failed";
            await updateFrontmatter(
              fs,
              absoluteDocPath,
              "failed",
              iterationsCompleted
            );
            options.onIterationComplete?.(iterationNumber, durationMs, false);
            return;
          }

          if (lastStopKind === "cancelled") {
            stopReason = "cancelled";
            await updateFrontmatter(fs, absoluteDocPath, "open", iterationsCompleted);
            return;
          }

          if (lastStopKind === "fatal") {
            await updateFrontmatter(fs, absoluteDocPath, "open", iterationsCompleted);
            return;
          }

          return;
        }

        if (result !== "completed") {
          return;
        }

        iterationsCompleted = iterationNumber;
        options.onIterationComplete?.(iterationNumber, durationMs, true);

        if (options.signal?.aborted) {
          stopReason = "cancelled";
          await updateFrontmatter(fs, absoluteDocPath, "open", iterationsCompleted);
          return;
        }

        if (iterationNumber === config.maxIterations) {
          await updateFrontmatter(
            fs,
            absoluteDocPath,
            "completed",
            iterationsCompleted
          );
          await archivePlan(fs, absoluteDocPath);
          archived = true;
          stopReason = "max_iterations";
          return;
        }

        await updateFrontmatter(
          fs,
          absoluteDocPath,
          "in_progress",
          iterationsCompleted
        );
      }
    });
  } catch (error) {
    if (fatalError !== undefined) {
      throw fatalError;
    }

    if (isAbortError(error)) {
      stopReason = "cancelled";
      if (!archived) {
        await updateFrontmatter(fs, absoluteDocPath, "open", iterationsCompleted);
      }
    } else {
      throw error;
    }
  }

  if (fatalError !== undefined) {
    throw fatalError;
  }

  if (stopReason === "max_iterations" && !archived && iterationsCompleted > 0) {
    await updateFrontmatter(fs, absoluteDocPath, "completed", iterationsCompleted);
    await archivePlan(fs, absoluteDocPath);
  } else if (stopReason === "cancelled" && !archived) {
    await updateFrontmatter(fs, absoluteDocPath, "open", iterationsCompleted);
  }

  return createRunResult(
    options.docPath,
    startTime,
    iterationsCompleted,
    stopReason
  );
}

function createRunResult(
  docPath: string,
  startTime: number,
  iterationsCompleted: number,
  stopReason: RalphRunResult["stopReason"]
): RalphRunResult {
  return {
    stopReason,
    docPath,
    iterationsCompleted,
    totalDurationMs: Date.now() - startTime
  };
}

async function resolveDocumentConfigFromContent(
  options: RalphRunOptions,
  fs: RalphFileSystem,
  absoluteDocPath: string,
  content: string
): Promise<{
  agents: AgentSpecifier[];
  maxIterations: number;
  prompt: string;
}> {
  const resolved = await resolve(
    [
      {
        source: "cli",
        data: resolveCliOverrides(options)
      },
      {
        source: "document",
        filePath: absoluteDocPath,
        content
      },
      {
        source: "base",
        path: path.join(options.cwd, ".poe-code/ralph/bases")
      },
      {
        source: "base",
        path: path.join(options.homeDir, ".poe-code/ralph/bases")
      },
      {
        source: "defaults",
        data: {
          agent: "claude-code",
          iterations: 3
        }
      }
    ],
    { fs }
  );

  const frontmatter = parseFrontmatterData(resolved.data);

  return {
    agents: normalizeAgents(frontmatter.agent),
    maxIterations: normalizeMaxIterations(frontmatter.iterations),
    prompt: interpolateVariables(normalizeResolvedPrompt(resolved.data.prompt), {
      current_file: absoluteDocPath
    })
  };
}

async function resolveDocumentConfig(
  options: RalphRunOptions,
  fs: RalphFileSystem,
  absoluteDocPath: string
): Promise<{
  agents: AgentSpecifier[];
  maxIterations: number;
  prompt: string;
}> {
  const rawContent = await fs.readFile(absoluteDocPath, "utf8");
  return resolveDocumentConfigFromContent(options, fs, absoluteDocPath, rawContent);
}

function createWorkflowFrontmatter(
  agents: AgentSpecifier[],
  maxIterations: number,
  prompt: string
): {
  participants: {
    default: {
      agent: string | string[];
      mode: "yolo";
    };
  };
  stages: [
    {
      id: "ralph";
      participant: "default";
      prompt: string;
      onFailure: "stop";
    }
  ];
  max_iterations: number;
} {
  const workflowAgents = agents.map((agent) => formatAgentSpecifier(agent));

  return {
    participants: {
      default: {
        agent: workflowAgents.length === 1 ? workflowAgents[0]! : workflowAgents,
        mode: "yolo"
      }
    },
    stages: [
      {
        id: "ralph",
        participant: "default",
        prompt,
        onFailure: "stop"
      }
    ],
    max_iterations: maxIterations
  };
}

function createDefaultFs(): RalphFileSystem {
  const fs = {
    readFile: fsPromises.readFile as RalphFileSystem["readFile"],
    writeFile: (filePath: string, content: string) =>
      fsPromises.writeFile(filePath, content, "utf8"),
    readdir: fsPromises.readdir,
    open: (filePath: string, flags: string) => fsPromises.open(filePath, flags),
    stat: async (filePath: string) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      } satisfies RalphFileStat;
    },
    unlink: async (filePath: string) => {
      await fsPromises.unlink(filePath);
    },
    mkdir: async (filePath: string, options?: { recursive?: boolean }) => {
      await fsPromises.mkdir(filePath, options);
    },
    rmdir: async (filePath: string) => {
      await fsPromises.rmdir(filePath);
    },
    rename: async (oldPath: string, newPath: string) => {
      await fsPromises.rename(oldPath, newPath);
    }
  };

  return fs as RalphFileSystem;
}

function normalizeAgents(
  agent: RalphRunOptions["agent"] | ReturnType<typeof parseFrontmatterData>["agent"]
): AgentSpecifier[] {
  if (agent === undefined) {
    throw new Error("Ralph doc is missing agent frontmatter.");
  }

  const raw = typeof agent === "string" ? [agent] : agent;

  if (raw.length === 0) {
    throw new Error("agent must contain at least one entry.");
  }

  return raw.map((entry) => {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      throw new Error("agent entries must be non-empty strings.");
    }
    return parseAgentSpecifier(trimmed);
  });
}

function resolveCliOverrides(options: RalphRunOptions): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if (options.agent !== undefined) {
    normalizeAgents(options.agent);
    data.agent = options.agent;
  }

  if (options.maxIterations !== undefined) {
    if (!Number.isInteger(options.maxIterations) || options.maxIterations < 1) {
      throw new Error("maxIterations must be a positive integer.");
    }

    data.iterations = options.maxIterations;
  }

  return data;
}

function normalizeMaxIterations(iterations: number | undefined): number {
  if (iterations === undefined) {
    throw new Error("Ralph doc is missing iterations frontmatter.");
  }

  return iterations;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function normalizeResolvedPrompt(prompt: unknown): string {
  if (prompt === undefined) {
    return "";
  }

  if (typeof prompt !== "string") {
    throw new Error("Ralph doc prompt must be a string.");
  }

  return prompt;
}

async function updateFrontmatter(
  fs: RalphFileSystem,
  absoluteDocPath: string,
  state: RalphPlanStatus,
  iteration: number
): Promise<void> {
  const currentContent = await fs.readFile(absoluteDocPath, "utf8");
  const { data: currentFrontmatter, body: currentBody } =
    parseFrontmatter(currentContent);
  const content = writeFrontmatter(
    {
      ...(currentFrontmatter.agent !== undefined
        ? { agent: currentFrontmatter.agent }
        : {}),
      ...(currentFrontmatter.extends !== undefined
        ? { extends: currentFrontmatter.extends }
        : {}),
      ...(currentFrontmatter.iterations !== undefined
        ? { iterations: currentFrontmatter.iterations }
        : {}),
      status: {
        state,
        iteration
      }
    },
    currentBody
  );
  await fs.writeFile(absoluteDocPath, content);
}

async function archivePlan(
  fs: RalphFileSystem,
  absoluteDocPath: string
): Promise<void> {
  const dir = path.dirname(absoluteDocPath);
  const archiveDir = path.join(dir, "archive");
  const archivePath = path.join(archiveDir, path.basename(absoluteDocPath));
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.rename(absoluteDocPath, archivePath);
}
