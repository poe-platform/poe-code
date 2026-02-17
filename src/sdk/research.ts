import path from "node:path";
import type { CliContainer } from "../cli/container.js";
import type {
  AcpEvent,
  AgentMessageEvent,
  SpawnMode
} from "@poe-code/agent-spawn";
import { spawn as spawnSdk } from "./spawn.js";
import type { SpawnResult } from "./types.js";

export interface ResearchLogger {
  info?: (message: string) => void;
  warn?: (message: string) => void;
}

export interface ResearchOptions {
  prompt: string;
  agent: string;
  agentLabel?: string;
  model?: string;
  mode?: SpawnMode;
  args?: string[];
  cwd?: string;
  path?: string;
  github?: string;
  keep?: boolean;
  logger?: ResearchLogger;
  resolveResumeCommand?: (threadId: string, cwd: string) => string | undefined;
}

export interface ResearchResult extends SpawnResult {
  markdownOutput: string;
  outputPath: string;
  cwd: string;
  github?: string;
}

interface ResolvedSource {
  cwd: string;
  github?: string;
  clonePath?: string;
  shouldCleanup: boolean;
}

const RESEARCH_SYSTEM_PROMPT = [
  "You are a codebase research assistant.",
  "Read files and answer the user's question about the codebase.",
  "Do not modify files or suggest edits.",
  "Respond in Markdown."
].join("\n");

export async function research(
  container: CliContainer,
  options: ResearchOptions
): Promise<{ events: AsyncIterable<AcpEvent>; result: Promise<ResearchResult> }> {
  const logger = options.logger;
  const source = await resolveSource({
    container,
    options,
    logger
  });
  const researchPrompt = buildResearchPrompt(options.prompt);
  const mode = options.mode ?? "read";

  const { events, result } = spawnSdk(options.agent, {
    prompt: researchPrompt,
    args: options.args ?? [],
    model: options.model,
    mode,
    cwd: source.cwd
  });

  const { teed, getOutput, done } = teeAcpStream(events);
  const resultPromise = (async (): Promise<ResearchResult> => {
    let outputPath: string | undefined;
    let markdownOutput = "";

    try {
      const final = await result;
      await done;
      markdownOutput = getOutput();

      const resumeCommand =
        final.threadId && options.resolveResumeCommand
          ? options.resolveResumeCommand(final.threadId, source.cwd)
          : undefined;

      const document = buildResearchDocument({
        prompt: options.prompt,
        agent: options.agent,
        path: source.cwd,
        github: source.github,
        resumeCommand,
        markdown: markdownOutput
      });

      outputPath = buildOutputPath(container.env.homeDir, options.prompt);
      await ensureDirectory(container.fs, path.dirname(outputPath));
      await container.fs.writeFile(outputPath, document, {
        encoding: "utf8"
      });

      if (final.exitCode !== 0) {
        const detail = final.stderr.trim() || final.stdout.trim();
        const suffix = detail ? `: ${detail}` : "";
        const label = options.agentLabel ?? options.agent;
        throw new Error(
          `${label} research failed with exit code ${final.exitCode}${suffix}`
        );
      }

      if (outputPath) {
        logger?.info?.(`Saved research to ${outputPath}`);
      }

      return {
        ...final,
        markdownOutput,
        outputPath,
        cwd: source.cwd,
        github: source.github
      };
    } finally {
      if (source.shouldCleanup && source.clonePath) {
        await removePath(container.fs, source.clonePath);
      }
    }
  })();

  return { events: teed, result: resultPromise };
}

export function buildSlug(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const maxLength = 48;
  let output = "";
  let pendingSeparator = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index] ?? "";
    const code = char.charCodeAt(0);
    if (isSlugChar(code)) {
      if (pendingSeparator && output.length > 0) {
        output += "-";
      }
      pendingSeparator = false;
      output += char;
    } else {
      pendingSeparator = true;
    }

    if (output.length >= maxLength) {
      break;
    }
  }

  output = trimTrailingDashes(output.slice(0, maxLength));
  return output.length > 0 ? output : "research";
}

export function buildResearchPrompt(prompt: string): string {
  return `${RESEARCH_SYSTEM_PROMPT}\n\n${prompt}`;
}

export function buildResearchDocument(input: {
  prompt: string;
  agent: string;
  path: string;
  github?: string;
  resumeCommand?: string;
  markdown: string;
}): string {
  const lines: string[] = ["---"];
  lines.push(`research_prompt: ${formatYamlString(input.prompt)}`);
  lines.push(`agent: ${formatYamlString(input.agent)}`);
  lines.push(`path: ${formatYamlString(input.path)}`);
  if (input.github) {
    lines.push(`github: ${formatYamlString(input.github)}`);
  }
  if (input.resumeCommand) {
    lines.push(`resume_session_cmd: ${formatYamlString(input.resumeCommand)}`);
  }
  lines.push("---", "", input.markdown);
  return lines.join("\n");
}

export function buildClonePath(homeDir: string, github: string): string {
  const slug = extractRepoSlug(github);
  return path.join(homeDir, ".poe-code", "repos", slug);
}

export function extractRepoSlug(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "repo";
  }

  let pathPart = trimmed;
  const schemeIndex = trimmed.indexOf("://");
  if (schemeIndex !== -1) {
    try {
      const url = new URL(trimmed);
      pathPart = url.pathname;
    } catch {
      pathPart = trimmed.slice(schemeIndex + 3);
    }
  } else if (trimmed.startsWith("git@")) {
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex !== -1) {
      pathPart = trimmed.slice(colonIndex + 1);
    }
  }

  if (pathPart.startsWith("/")) {
    pathPart = pathPart.slice(1);
  }

  if (pathPart.endsWith(".git")) {
    pathPart = pathPart.slice(0, -4);
  }

  const parts = pathPart.split("/");
  const owner = parts[0] ?? "";
  const repo = parts[1] ?? "";
  const combined = repo.length > 0 ? `${owner}-${repo}` : owner;
  const slug = buildSlug(combined);
  return slug.length > 0 ? slug : buildSlug(trimmed);
}

export function buildOutputPath(
  homeDir: string,
  prompt: string,
  now: Date = new Date()
): string {
  const timestamp = formatTimestamp(now);
  const slug = buildSlug(prompt);
  return path.join(
    homeDir,
    ".poe-code",
    "research",
    `${timestamp}-${slug}.md`
  );
}

export function resolveGithubCloneUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("git@") || trimmed.includes("://")) {
    return trimmed;
  }
  const suffix = trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`;
  return `https://github.com/${suffix}`;
}

export async function resolveSource(input: {
  container: CliContainer;
  options: {
    cwd?: string;
    path?: string;
    github?: string;
    keep?: boolean;
  };
  logger?: ResearchLogger;
}): Promise<ResolvedSource> {
  const { container, options } = input;
  const logger = input.logger;

  if (options.github) {
    const cloneUrl = resolveGithubCloneUrl(options.github);
    const clonePath = buildClonePath(container.env.homeDir, options.github);
    await ensureDirectory(container.fs, path.dirname(clonePath));

    const exists = await pathExists(container.fs, clonePath);
    if (!exists) {
      const cloneResult = await container.commandRunner(
        "git",
        ["clone", "--depth", "1", cloneUrl, clonePath]
      );
      if (cloneResult.exitCode !== 0) {
        throw new Error(
          `git clone failed with exit code ${cloneResult.exitCode}: ${cloneResult.stderr.trim()}`
        );
      }

      return {
        cwd: clonePath,
        github: options.github,
        clonePath,
        shouldCleanup: !options.keep
      };
    }

    const statusResult = await container.commandRunner(
      "git",
      ["status", "--porcelain"],
      { cwd: clonePath }
    );

    if (statusResult.exitCode !== 0) {
      logger?.warn?.("Unable to check git status; using existing clone.");
    } else if (statusResult.stdout.trim().length > 0) {
      logger?.warn?.("Repo has uncommitted changes; skipping update.");
    } else {
      const pullResult = await container.commandRunner(
        "git",
        ["pull", "--ff-only"],
        { cwd: clonePath }
      );
      if (pullResult.exitCode !== 0) {
        logger?.warn?.("Git pull failed; using existing clone.");
      }
    }

    return {
      cwd: clonePath,
      github: options.github,
      clonePath,
      shouldCleanup: false
    };
  }

  if (options.path) {
    return {
      cwd: resolvePath(container.env.cwd, options.path),
      shouldCleanup: false
    };
  }

  if (options.cwd) {
    return {
      cwd: resolvePath(container.env.cwd, options.cwd),
      shouldCleanup: false
    };
  }

  return {
    cwd: container.env.cwd,
    shouldCleanup: false
  };
}

function isSlugChar(code: number): boolean {
  if (code >= 48 && code <= 57) {
    return true;
  }
  if (code >= 97 && code <= 122) {
    return true;
  }
  return false;
}

function trimTrailingDashes(value: string): string {
  let output = value;
  while (output.endsWith("-")) {
    output = output.slice(0, -1);
  }
  return output;
}

function formatTimestamp(now: Date): string {
  const year = now.getUTCFullYear();
  const month = padNumber(now.getUTCMonth() + 1, 2);
  const day = padNumber(now.getUTCDate(), 2);
  const hours = padNumber(now.getUTCHours(), 2);
  const minutes = padNumber(now.getUTCMinutes(), 2);
  const seconds = padNumber(now.getUTCSeconds(), 2);
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function padNumber(value: number, length: number): string {
  let output = String(value);
  while (output.length < length) {
    output = `0${output}`;
  }
  return output;
}

function formatYamlString(value: string): string {
  return JSON.stringify(value);
}

function resolvePath(baseDir: string, candidate: string): string {
  if (path.isAbsolute(candidate)) {
    return candidate;
  }
  return path.resolve(baseDir, candidate);
}

function teeAcpStream(events: AsyncIterable<AcpEvent>): {
  teed: AsyncIterable<AcpEvent>;
  getOutput: () => string;
  done: Promise<void>;
} {
  const chunks: string[] = [];
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const teed = (async function* () {
    try {
      for await (const event of events) {
        if (event.event === "agent_message") {
          chunks.push((event as AgentMessageEvent).text);
        }
        yield event;
      }
    } finally {
      resolveDone?.();
    }
  })();

  return {
    teed,
    getOutput: () => chunks.join(""),
    done
  };
}

async function ensureDirectory(
  fs: CliContainer["fs"],
  target: string
): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

async function pathExists(
  fs: CliContainer["fs"],
  target: string
): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function removePath(
  fs: CliContainer["fs"],
  target: string
): Promise<void> {
  if (typeof fs.rm === "function") {
    await fs.rm(target, { recursive: true, force: true });
    return;
  }

  await removePathFallback(fs, target);
}

async function removePathFallback(
  fs: CliContainer["fs"],
  target: string
): Promise<void> {
  let stats: { isDirectory?: () => boolean } | undefined;
  try {
    stats = await fs.stat(target);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }

  if (stats && typeof stats.isDirectory === "function" && stats.isDirectory()) {
    const entries = await fs.readdir(target);
    for (const entry of entries) {
      await removePathFallback(fs, path.join(target, entry));
    }
  }

  try {
    await fs.unlink(target);
  } catch {
    // Ignore errors if unlink fails on directories in fallback.
  }
}
