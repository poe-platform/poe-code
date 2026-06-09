import path from "node:path";
import { randomUUID } from "node:crypto";
import * as fsPromises from "node:fs/promises";
import {
  archivePlan as archivePlanShared,
  ensureSafeRunLogDir,
  makeRunLogFileName,
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
import type { RalphFileStat, RalphFileSystem, RalphRunOptions, RalphRunResult } from "../types.js";
import { interpolateVariables } from "../variables/variables.js";

type SharedArchivePlanFs = NonNullable<Parameters<typeof archivePlanShared>[0]["fs"]>;

class RalphWorkflowStopError extends Error {
  constructor(readonly kind: "failed" | "cancelled" | "fatal") {
    super(`Ralph workflow stopped: ${kind}`);
    this.name = "RalphWorkflowStopError";
  }
}

export async function runRalph(options: RalphRunOptions): Promise<RalphRunResult> {
  const fs = options.fs ?? createDefaultFs();
  const runAgent = options.runAgent;
  if (!runAgent) {
    throw new Error("runRalph requires a runAgent implementation.");
  }

  const absoluteDocPath = resolveWorkflowPath(options.docPath, options.cwd, options.homeDir);
  await rejectSymbolicLink(absoluteDocPath, fs);
  const planDirectory = path.dirname(options.docPath);
  const runLogDir = await ensureSafeRunLogDir({
    planPath: absoluteDocPath,
    runner: "ralph",
    homeDir: options.homeDir,
    fs
  });
  const config = await resolveDocumentConfig(options, fs, absoluteDocPath);
  let currentConfig = config;
  const startTime = Date.now();
  let iterationsCompleted = 0;
  let currentIterationStart = 0;
  let currentIterationNumber = 0;
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
        const fresh = await resolveDocumentConfigFromContent(options, fs, absoluteDocPath, content);
        currentConfig = fresh;
        return {
          frontmatter: createWorkflowFrontmatter(
            fresh.agents,
            fresh.maxIterations,
            fresh.prompt,
            fresh.skills,
            fresh.hooks
          ),
          body: fresh.prompt
        };
      },
      runAgent: async (input) => {
        const specifier = parseAgentSpecifier(input.agent);

        try {
          const result = await runAgent({
            agent: specifier.agent,
            prompt: interpolateVariables(input.prompt, {
              current_iteration: String(currentIterationNumber),
              max_iterations: String(currentConfig.maxIterations)
            }),
            cwd: input.cwd,
            logDir: runLogDir,
            logFileName: makeRunLogFileName(specifier.agent),
            ...(options.runtime ? { runtime: options.runtime } : {}),
            ...(options.runtimeImage ? { runtimeImage: options.runtimeImage } : {}),
            ...(options.runtimeTemplate ? { runtimeTemplate: options.runtimeTemplate } : {}),
            ...(options.runtimeConfigCwd ? { runtimeConfigCwd: options.runtimeConfigCwd } : {}),
            ...(options.detach ? { detach: options.detach } : {}),
            ...(options.mountPoeCode ? { mountPoeCode: options.mountPoeCode } : {}),
            ...(options.runnerSync ? { runnerSync: options.runnerSync } : {}),
            ...((specifier.model ?? input.model) ? { model: specifier.model ?? input.model } : {}),
            ...(input.skills ? { skills: input.skills } : {}),
            ...(input.hooks ? { hooks: input.hooks } : {}),
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

          if (isAbortError(error) || options.signal?.aborted) {
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
        currentIterationNumber = iteration + 1;

        if (iteration === 0) {
          await updateFrontmatter(fs, absoluteDocPath, "in_progress", 0);
        }

        const currentSpecifier = currentConfig.agents[iteration % currentConfig.agents.length]!;
        options.onIterationStart?.(iteration + 1, currentConfig.maxIterations, currentSpecifier.agent);
      },
      onIterationEnd: async (iteration, result) => {
        const iterationNumber = iteration + 1;
        const durationMs = Date.now() - currentIterationStart;

        if (result === "failed") {
          if (lastStopKind === "failed") {
            iterationsCompleted = iterationNumber;
            stopReason = "failed";
            await updateFrontmatter(fs, absoluteDocPath, "failed", iterationsCompleted);
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
          await updateFrontmatter(fs, absoluteDocPath, "completed", iterationsCompleted);
          stopReason = "max_iterations";
          return;
        }

        await updateFrontmatter(fs, absoluteDocPath, "in_progress", iterationsCompleted);
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
    const id = path.basename(absoluteDocPath, ".md").replace(/^\d+-/, "");
    await archivePlanShared({
      cwd: options.cwd,
      homeDir: options.homeDir,
      planDirectory,
      id,
      fs: fs as unknown as SharedArchivePlanFs
    });
    archived = true;
  } else if (stopReason === "cancelled" && !archived) {
    await updateFrontmatter(fs, absoluteDocPath, "open", iterationsCompleted);
  }

  return createRunResult(options.docPath, startTime, iterationsCompleted, stopReason);
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
  skills?: string[];
  hooks?: ReturnType<typeof parseFrontmatterData>["hooks"];
  prompt: string;
}> {
  const projectBasePath = path.join(options.cwd, ".poe-code/ralph/bases");
  const homeBasePath = path.join(options.homeDir, ".poe-code/ralph/bases");
  await rejectSymbolicLinkIfPresent(projectBasePath, fs);
  await rejectSymbolicLinkIfPresent(homeBasePath, fs);
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
        path: projectBasePath
      },
      {
        source: "base",
        path: homeBasePath
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
    ...(frontmatter.skills !== undefined ? { skills: frontmatter.skills } : {}),
    ...(frontmatter.hooks !== undefined ? { hooks: frontmatter.hooks } : {}),
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
  skills?: string[];
  hooks?: ReturnType<typeof parseFrontmatterData>["hooks"];
  prompt: string;
}> {
  const rawContent = await fs.readFile(absoluteDocPath, "utf8");
  return resolveDocumentConfigFromContent(options, fs, absoluteDocPath, rawContent);
}

function createWorkflowFrontmatter(
  agents: AgentSpecifier[],
  maxIterations: number,
  prompt: string,
  skills: string[] | undefined,
  hooks: ReturnType<typeof parseFrontmatterData>["hooks"]
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
      skills?: string[];
      hooks?: ReturnType<typeof parseFrontmatterData>["hooks"];
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
        ...(skills !== undefined ? { skills } : {}),
        ...(hooks !== undefined ? { hooks } : {}),
        onFailure: "stop"
      }
    ],
    max_iterations: maxIterations
  };
}

function createDefaultFs(): RalphFileSystem {
  const fs = {
    readFile: fsPromises.readFile as RalphFileSystem["readFile"],
    writeFile: (filePath: string, content: string, options?: { flag?: string; mode?: number }) =>
      fsPromises.writeFile(filePath, content, { encoding: "utf8", ...options }),
    readdir: fsPromises.readdir,
    open: (filePath: string, flags: string) => fsPromises.open(filePath, flags),
    lstat: async (filePath: string) => {
      const stat = await fsPromises.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
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
    },
    realpath: fsPromises.realpath
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
    const specifier = parseAgentSpecifier(trimmed);
    if (specifier.agent.length === 0) {
      throw new Error("agent entries must include a non-empty agent id.");
    }
    return specifier;
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

async function rejectSymbolicLink(filePath: string, fs: Pick<RalphFileSystem, "lstat">): Promise<void> {
  if ((await fs.lstat(filePath)).isSymbolicLink()) {
    throw new Error(`Refusing to run Ralph through symbolic link: ${filePath}`);
  }
}

async function rejectSymbolicLinkIfPresent(
  filePath: string,
  fs: Pick<RalphFileSystem, "lstat">
): Promise<void> {
  try {
    await rejectSymbolicLink(filePath, fs);
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

async function updateFrontmatter(
  fs: RalphFileSystem,
  absoluteDocPath: string,
  state: RalphPlanStatus,
  iteration: number
): Promise<void> {
  const currentContent = await fs.readFile(absoluteDocPath, "utf8");
  const { data: currentFrontmatter, body: currentBody } = parseFrontmatter(currentContent);
  const content = writeFrontmatter(
    {
      ...(currentFrontmatter.agent !== undefined ? { agent: currentFrontmatter.agent } : {}),
      ...(currentFrontmatter.extends !== undefined ? { extends: currentFrontmatter.extends } : {}),
      ...(currentFrontmatter.iterations !== undefined
        ? { iterations: currentFrontmatter.iterations }
        : {}),
      ...(currentFrontmatter.skills !== undefined ? { skills: currentFrontmatter.skills } : {}),
      status: {
        state,
        iteration
      }
    },
    currentBody
  );
  const legacyTemporaryPath = `${absoluteDocPath}.tmp`;
  const temporaryPath = `${absoluteDocPath}.${randomUUID()}.tmp`;
  let temporaryCreated = false;
  try {
    await rejectSymbolicLinkIfPresent(legacyTemporaryPath, fs);
    await rejectSymbolicLinkIfPresent(temporaryPath, fs);
    try {
      await fs.writeFile(temporaryPath, content, { flag: "wx", mode: 0o600 });
      temporaryCreated = true;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        await fs.unlink(temporaryPath).catch(() => undefined);
      }
      throw error;
    }
    await fs.rename(temporaryPath, absoluteDocPath);
  } catch (error) {
    if (temporaryCreated) {
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function hasOwnErrorCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === code
  );
}
