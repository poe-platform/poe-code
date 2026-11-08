import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Dirent } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  GitHubRateLimitError,
  type GitHubRateLimitStatus,
  type ReviewHistoryComment,
  fetchReviewHistory
} from "github-review";
import { type SpawnOptions, type SpawnResult, spawn } from "@poe-code/agent-spawn";
import { loadCodeReviewRolePrompt } from "./assets.js";
import { loadDefaultPoeCodeAgent } from "./config.js";
import { buildCodeReviewProfileSynthesisPrompt } from "./prompt-builders.js";
import {
  parseCodeReviewProfileMarkdown,
  requireGitHubActorName,
  requireSafeDocumentSegment,
  serializeCodeReviewIngestSource
} from "./document-schemas.js";
import { hasOwnErrorCode } from "./error-codes.js";

export const DEFAULT_CODE_REVIEW_INGEST_DIRECTORY = ".poe-code/code-review/ingest";
export const DEFAULT_CODE_REVIEW_PROFILES_DIRECTORY = ".poe-code/code-review/profiles";

export interface CodeReviewIngestInput {
  username: string;
  repos: readonly string[];
  profile?: string;
  agent?: string;
  cwd: string;
}

export function parseCodeReviewIngestArgs(args: string[]): CodeReviewIngestInput {
  const [username, ...flags] = args;
  const input: {
    username: string;
    repos: string[];
    profile?: string;
    agent?: string;
    cwd: string;
  } = {
    username: username ?? "",
    repos: [],
    cwd: process.cwd()
  };
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (!flag?.startsWith("--")) {
      throw new Error(`Unknown code-review ingest arg: ${flag}`);
    }
    const value = flags[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    switch (flag) {
      case "--repo":
        if (value.includes(",")) {
          throw new Error(
            "Use repeated --repo owner/name flags; comma-separated repositories are not supported."
          );
        }
        input.repos.push(value);
        break;
      case "--profile":
        input.profile = value;
        break;
      case "--agent":
        input.agent = value;
        break;
      case "--cwd":
        input.cwd = value;
        break;
      default:
        throw new Error(`Unknown code-review ingest arg: ${flag}`);
    }
    index += 1;
  }
  return input;
}

export interface NormalizedIngestComment {
  repo: string;
  pullRequestNumber: number;
  pullRequestTitle: string;
  createdAt: string;
  kind: ReviewHistoryComment["kind"];
  body: string;
  path?: string;
  line?: number;
  diffHunk?: string;
}

export interface CodeReviewIngestResult {
  profile: string;
  profilePath: string;
  artifactsDirectory: string;
  sourcePath: string;
  commentsPath: string;
  promptPath: string;
  commentCount: number;
  partial: boolean;
  spawnResult: SpawnResult;
}

export interface CodeReviewIngestDependencies {
  fetchHistory?: typeof fetchReviewHistory;
  resolveAgent?: () => string | undefined | Promise<string | undefined>;
  loadPrompt?: (input: { cwd: string; role: "profile-synthesis" }) => Promise<string>;
  spawnAgent?: (
    agent: string,
    prompt: string,
    options: Omit<SpawnOptions, "prompt">
  ) => Promise<SpawnResult>;
  now?: () => Date;
}

interface IngestObservation {
  partial: boolean;
  rateLimit?: GitHubRateLimitStatus;
}

export async function ingestCodeReviewProfile(
  input: CodeReviewIngestInput,
  dependencies: CodeReviewIngestDependencies = {}
): Promise<CodeReviewIngestResult> {
  const cwd = resolve(requireNonEmpty(input.cwd, "cwd"));
  const username = requireGitHubActorName(input.username, "Code-review github username");
  const repos = validateRepos(input.repos);
  const profile = validateProfileName(input.profile ?? username);
  const agent =
    input.agent?.trim() ||
    (await (dependencies.resolveAgent
      ? dependencies.resolveAgent()
      : loadDefaultPoeCodeAgent({ cwd })));
  if (!agent?.trim()) {
    throw new Error(
      "No code-review agent resolved; pass --agent or configure the normal poe-code default agent."
    );
  }

  const artifactsDirectory = join(cwd, DEFAULT_CODE_REVIEW_INGEST_DIRECTORY, profile);
  const profilePath = join(cwd, DEFAULT_CODE_REVIEW_PROFILES_DIRECTORY, `${profile}.md`);
  const sourcePath = join(artifactsDirectory, "source.yaml");
  const commentsPath = join(artifactsDirectory, "comments.jsonl");
  const promptPath = join(artifactsDirectory, "synthesis-prompt.md");
  const legacyGeneratedProfilePath = join(artifactsDirectory, "generated-profile.md");
  await ensureContainedDirectory(cwd, dirname(profilePath));
  await assertNoNormalizedProfileCollision(dirname(profilePath), profile);
  await ensureContainedDirectory(cwd, artifactsDirectory);
  await assertRegularFileOrMissing(profilePath);
  const previousProfile = await readRegularFileOrMissing(profilePath);

  const comments: NormalizedIngestComment[] = [];
  let observation: IngestObservation = { partial: false };
  try {
    for await (const comment of (dependencies.fetchHistory ?? fetchReviewHistory)({
      username,
      repos,
      cwd
    })) {
      comments.push(normalizeComment(comment));
    }
  } catch (error) {
    if (!(error instanceof GitHubRateLimitError)) {
      throw error;
    }
    observation = { partial: true, rateLimit: error.status };
  }

  await writeTextAtomically(
    cwd,
    commentsPath,
    comments.map((comment) => JSON.stringify(comment)).join("\n") + (comments.length ? "\n" : "")
  );
  await writeTextAtomically(
    cwd,
    sourcePath,
    serializeSource({
      username,
      repos,
      fetchedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
      profilePath,
      commentCount: comments.length,
      observation
    })
  );
  const synthesisPrompt = buildCodeReviewProfileSynthesisPrompt({
    template: await (dependencies.loadPrompt ?? loadCodeReviewRolePrompt)({
      cwd,
      role: "profile-synthesis"
    }),
    commentsPath,
    profilePath,
    partial: observation.partial
  });
  await writeTextAtomically(cwd, promptPath, synthesisPrompt);
  await removeStaleLegacyOutput(legacyGeneratedProfilePath);
  await rm(profilePath, { force: true });
  let spawnResult: SpawnResult;
  try {
    spawnResult = await (dependencies.spawnAgent ?? spawnWithPoeCode)(
      agent.trim(),
      synthesisPrompt,
      { cwd }
    );
    if (spawnResult.exitCode !== 0) {
      throw new Error(
        `Code-review profile synthesis failed: ${spawnResult.stderr || `exit ${spawnResult.exitCode}`}`
      );
    }
    await validateGeneratedProfile(profilePath, profilePath, username);
  } catch (error) {
    await restoreProfileAfterFailedSynthesis(cwd, profilePath, previousProfile);
    throw error;
  }
  return {
    profile,
    profilePath,
    artifactsDirectory,
    sourcePath,
    commentsPath,
    promptPath,
    commentCount: comments.length,
    partial: observation.partial,
    spawnResult
  };
}

function normalizeComment(comment: ReviewHistoryComment): NormalizedIngestComment {
  return {
    repo: comment.repo,
    pullRequestNumber: comment.pullRequestNumber,
    pullRequestTitle: comment.pullRequestTitle,
    createdAt: comment.createdAt,
    kind: comment.kind,
    body: comment.body,
    ...(comment.path ? { path: comment.path } : {}),
    ...(comment.line === undefined ? {} : { line: comment.line }),
    ...(comment.diffHunk ? { diffHunk: comment.diffHunk } : {})
  };
}

function serializeSource(input: {
  username: string;
  repos: readonly string[];
  fetchedAt: string;
  profilePath: string;
  commentCount: number;
  observation: IngestObservation;
}): string {
  return serializeCodeReviewIngestSource({
    version: 1,
    username: input.username,
    repos: [...input.repos],
    fetchedAt: input.fetchedAt,
    pagination: {
      partial: input.observation.partial,
      commentsWritten: input.commentCount,
      ...(input.observation.rateLimit
        ? { resumeEndpoint: input.observation.rateLimit.resumeEndpoint }
        : {})
    },
    rateLimit: input.observation.rateLimit
      ? {
          repo: input.observation.rateLimit.repo,
          limit: input.observation.rateLimit.limit,
          remaining: input.observation.rateLimit.remaining,
          resetAt: input.observation.rateLimit.resetAt?.toISOString() ?? null,
          retryAfter: input.observation.rateLimit.retryAfter,
          partialResults: input.observation.rateLimit.partialResults,
          reason: input.observation.rateLimit.reason
        }
      : null,
    outputProfilePath: input.profilePath
  });
}

async function validateGeneratedProfile(
  generatedProfilePath: string,
  profilePath: string,
  username: string
): Promise<string> {
  let profile: string;
  try {
    profile = await readRegularFile(generatedProfilePath);
  } catch (error) {
    throw new Error(`Profile synthesis did not write ${generatedProfilePath}`, {
      cause: error
    });
  }
  if (!profile.trim()) {
    throw new Error(`Profile synthesis wrote an empty profile: ${generatedProfilePath}`);
  }
  const body = parseCodeReviewProfileMarkdown(profile, profilePath).content;
  if (!/\b(?:I|my|mine)\b/i.test(body)) {
    throw new Error("Profile synthesis output must be written in first person.");
  }
  const prohibited = [
    new RegExp(`@${escapeRegExp(username)}\\b`, "i"),
    /@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\b/,
    /https?:\/\//i,
    /\bgithub\.com\b/i,
    /\bgithub username\b/i,
    /\b(?:generated profile|profile (?:was|is) generated)\b/i
  ];
  for (const pattern of prohibited) {
    if (pattern.test(body)) {
      throw new Error("Profile synthesis output contains prohibited source attribution.");
    }
  }
  return profile;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateRepos(values: readonly string[]): string[] {
  if (values.length === 0) {
    throw new Error("At least one --repo owner/name flag is required.");
  }
  return values.map((value) => {
    const repo = value;
    if (
      !repo
        .split("/")
        .every(
          (part) =>
            /^[A-Za-z0-9_.-]+$/.test(part) &&
            part.normalize("NFKC") === part &&
            !part.startsWith(".")
        ) ||
      repo.split("/").length !== 2
    ) {
      throw new Error(`Invalid GitHub repository: ${repo}`);
    }
    return repo;
  });
}

function validateProfileName(value: string): string {
  const profile = value;
  try {
    requireSafeDocumentSegment(profile, "profile");
  } catch {
    throw new Error(`Invalid code-review profile name: ${profile}`);
  }
  return profile;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Code-review ${label} is required.`);
  }
  return normalized;
}

async function spawnWithPoeCode(
  agent: string,
  prompt: string,
  options: Omit<SpawnOptions, "prompt">
): Promise<SpawnResult> {
  return spawn(agent, { prompt, ...options });
}

async function ensureContainedDirectory(cwd: string, targetDirectory: string) {
  const pathFromCwd = relative(cwd, targetDirectory);
  if (pathFromCwd.startsWith("..") || pathFromCwd.startsWith(sep)) {
    throw new Error(`Code-review ingest directory escapes repository: ${targetDirectory}`);
  }
  await mkdir(cwd, { recursive: true });
  const cwdStatus = await stat(cwd);
  if (!cwdStatus.isDirectory()) {
    throw new Error(`Code-review repository path is not a directory: ${cwd}`);
  }
  let currentDirectory = cwd;
  for (const segment of pathFromCwd.split(sep).filter(Boolean)) {
    currentDirectory = join(currentDirectory, segment);
    try {
      await mkdir(currentDirectory);
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
    const status = await lstat(currentDirectory);
    if (!status.isDirectory()) {
      throw new Error(
        `Code-review ingest directory is not a regular directory: ${currentDirectory}`
      );
    }
  }
}

async function assertRegularFileOrMissing(filePath: string): Promise<void> {
  try {
    const status = await lstat(filePath);
    if (!status.isFile()) {
      throw new Error(`Code-review ingest path is not a regular file: ${filePath}`);
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

async function writeTextAtomically(cwd: string, filePath: string, content: string): Promise<void> {
  await ensureContainedDirectory(cwd, dirname(filePath));
  const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
  if (await pathExists(temporaryPath)) {
    throw new Error(`Code-review ingest temporary path already exists: ${temporaryPath}`);
  }
  let temporary: Awaited<ReturnType<typeof open>> | undefined;
  let temporaryCreated = false;
  try {
    temporary = await open(temporaryPath, "wx");
    temporaryCreated = true;
    await temporary.writeFile(content, "utf8");
    await temporary.sync();
    await temporary.close();
    temporary = undefined;
    await rename(temporaryPath, filePath);
    temporaryCreated = false;
    await syncDirectory(dirname(filePath));
  } catch (error) {
    await temporary?.close().catch(() => undefined);
    if (temporaryCreated) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

async function assertNoNormalizedProfileCollision(
  profilesDirectory: string,
  profile: string
): Promise<void> {
  const normalizedProfile = profile.normalize("NFKC").toLowerCase();
  let entries: Dirent<string>[];
  try {
    entries = await readdir(profilesDirectory, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) {
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `Code-review ingest path is not a regular file: ${join(profilesDirectory, entry.name)}`
      );
    }
    const existing = entry.name.slice(0, -".md".length);
    if (existing !== profile && existing.normalize("NFKC").toLowerCase() === normalizedProfile) {
      throw new Error(`Code-review profile name collides with existing filename: ${profile}`);
    }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const parent = await open(directory, constants.O_RDONLY);
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

async function readRegularFile(filePath: string): Promise<string> {
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await handle.stat()).isFile()) {
      throw new Error(`Code-review ingest path is not a regular file: ${filePath}`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function readRegularFileOrMissing(filePath: string): Promise<string | undefined> {
  try {
    return await readRegularFile(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function restoreProfileAfterFailedSynthesis(
  cwd: string,
  profilePath: string,
  previousProfile: string | undefined
): Promise<void> {
  if (previousProfile !== undefined) {
    await writeTextAtomically(cwd, profilePath, previousProfile);
    return;
  }
  try {
    const status = await lstat(profilePath);
    if (status.isDirectory()) {
      throw new Error(`Code-review ingest path is not a regular file: ${profilePath}`);
    }
    await rm(profilePath, { force: true });
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

async function removeStaleLegacyOutput(filePath: string): Promise<void> {
  try {
    const status = await lstat(filePath);
    if (status.isDirectory()) {
      throw new Error(`Code-review ingest path is not a regular file: ${filePath}`);
    }
    await rm(filePath, { force: true });
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function isMissingFileError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}
