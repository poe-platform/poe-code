import { resolvePath } from "@poe-code/safe-fs/core";
import { type CommandContext, type CommandDefinition, type CommandHandler } from "safe-bash-contracts";
import type { FileSystem } from "@poe-code/safe-fs/core";
import { createGitCommand } from "safe-bash-command-git";
import { bytesToHex, decodeUtf8, encodeUtf8, sha1Sync } from "./crypto-ssh.js";
import type { GhCommitRecord, GhFileChange } from "./types.js";

let cachedGitCommand: CommandDefinition | undefined;
function getDefaultGitCommand(): CommandDefinition {
  if (!cachedGitCommand) {
    cachedGitCommand = createGitCommand();
  }
  return cachedGitCommand;
}

export interface RepoCoordinates {
  readonly host: string;
  readonly owner: string;
  readonly name: string;
  readonly nameWithOwner: string;
}

export function parseRepoSpec(spec: string, defaultHost = "github.com", defaultOwner?: string): RepoCoordinates {
  const trimmed = spec.trim().replace(/\/+$/u, "");
  // SSH URL: git@github.com:owner/repo.git
  const sshMatch = /^(?:ssh:\/\/)?git@([^/:]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(trimmed);
  if (sshMatch) {
    const host = sshMatch[1]!;
    const owner = sshMatch[2]!;
    const name = sshMatch[3]!;
    return { host, owner, name, nameWithOwner: `${owner}/${name}` };
  }
  // HTTP/HTTPS URL: https://github.com/owner/repo.git
  if (/^https?:\/\//u.test(trimmed)) {
    const url = new URL(trimmed);
    const parts = url.pathname
      .replace(/^\/+|\/+$/gu, "")
      .replace(/\.git$/u, "")
      .split("/");
    if (parts.length >= 2) {
      const owner = parts[0]!;
      const name = parts[1]!;
      return { host: url.hostname, owner, name, nameWithOwner: `${owner}/${name}` };
    }
  }
  const clean = trimmed.replace(/\.git$/u, "");
  const segments = clean.split("/").filter(Boolean);
  if (segments.length === 3) {
    const [host, owner, name] = segments as [string, string, string];
    return { host, owner, name, nameWithOwner: `${owner}/${name}` };
  }
  if (segments.length === 2) {
    const [owner, name] = segments as [string, string];
    return { host: defaultHost, owner, name, nameWithOwner: `${owner}/${name}` };
  }
  if (segments.length === 1 && defaultOwner) {
    const name = segments[0]!;
    return { host: defaultHost, owner: defaultOwner, name, nameWithOwner: `${defaultOwner}/${name}` };
  }
  throw new Error(`expected the "[HOST/]OWNER/REPO" format, got "${spec}"`);
}

export async function pathExists(fs: FileSystem, path: string, signal: AbortSignal): Promise<boolean> {
  try {
    await fs.lstat(path, { signal });
    return true;
  } catch {
    return false;
  }
}

export async function findGitRoot(
  fs: FileSystem,
  startCwd: string,
  signal: AbortSignal
): Promise<string | undefined> {
  let current = resolvePath("/", startCwd);
  for (let depth = 0; depth < 64; depth++) {
    const gitPath = current === "/" ? "/.git" : `${current}/.git`;
    if (await pathExists(fs, gitPath, signal)) {
      return current;
    }
    if (current === "/") break;
    const slashIdx = current.lastIndexOf("/");
    current = slashIdx <= 0 ? "/" : current.slice(0, slashIdx);
  }
  return undefined;
}

export interface GitRemoteConfig {
  readonly name: string;
  readonly url: string;
  readonly ghResolved?: string | undefined;
}

export interface ParsedGitConfig {
  readonly remotes: Map<string, GitRemoteConfig>;
  readonly branches: Map<string, { readonly remote?: string | undefined; readonly merge?: string | undefined; readonly ghMergeBase?: string | undefined }>;
  readonly raw: string;
}

export async function readGitConfig(
  fs: FileSystem,
  repoRoot: string,
  signal: AbortSignal
): Promise<ParsedGitConfig> {
  const configPath = `${repoRoot === "/" ? "" : repoRoot}/.git/config`;
  let raw = "";
  try {
    raw = decodeUtf8(await fs.readFile(configPath, { signal }));
  } catch {
    raw = "";
  }
  const remotes = new Map<string, GitRemoteConfig>();
  const branches = new Map<string, { remote?: string | undefined; merge?: string | undefined; ghMergeBase?: string | undefined }>();

  let currentSection = "";
  let currentSub = "";
  for (const rawLine of raw.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const secMatch = /^\[([a-zA-Z0-9_-]+)(?:\s+"([^"]+)")?\]$/u.exec(line);
    if (secMatch) {
      currentSection = secMatch[1]!.toLowerCase();
      currentSub = secMatch[2] ?? "";
      continue;
    }
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().toLowerCase();
    const val = line.slice(eqIdx + 1).trim();
    if (currentSection === "remote" && currentSub) {
      const existing = remotes.get(currentSub) ?? { name: currentSub, url: "" };
      if (key === "url") remotes.set(currentSub, { ...existing, url: val });
      else if (key === "gh-resolved") remotes.set(currentSub, { ...existing, ghResolved: val });
    } else if (currentSection === "branch" && currentSub) {
      const existing = branches.get(currentSub) ?? {};
      if (key === "remote") branches.set(currentSub, { ...existing, remote: val });
      else if (key === "merge") branches.set(currentSub, { ...existing, merge: val });
      else if (key === "gh-merge-base") branches.set(currentSub, { ...existing, ghMergeBase: val });
    }
  }
  return { remotes, branches, raw };
}

export async function updateGitRemote(
  fs: FileSystem,
  repoRoot: string,
  remoteName: string,
  url: string,
  ghResolved: string | undefined,
  signal: AbortSignal
): Promise<void> {
  const configPath = `${repoRoot === "/" ? "" : repoRoot}/.git/config`;
  const parsed = await readGitConfig(fs, repoRoot, signal);
  const lines = parsed.raw ? parsed.raw.split(/\r?\n/u) : [];
  const header = `[remote "${remoteName}"]`;
  const newLines: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      skipping = trimmed === header;
    }
    if (!skipping) newLines.push(line);
  }
  while (newLines.length > 0 && newLines[newLines.length - 1] === "") {
    newLines.pop();
  }
  newLines.push(header);
  newLines.push(`\turl = ${url}`);
  newLines.push(`\tfetch = +refs/heads/*:refs/remotes/${remoteName}/*`);
  if (ghResolved) {
    newLines.push(`\tgh-resolved = ${ghResolved}`);
  }
  newLines.push("");
  await fs.writeFile(configPath, encodeUtf8(newLines.join("\n")), { signal });
}

export async function setDefaultRepoInGitConfig(
  fs: FileSystem,
  repoRoot: string,
  targetRepoNameWithOwner: string | undefined,
  signal: AbortSignal
): Promise<string | undefined> {
  const configPath = `${repoRoot === "/" ? "" : repoRoot}/.git/config`;
  const parsed = await readGitConfig(fs, repoRoot, signal);
  if (targetRepoNameWithOwner === undefined) {
    const updated = parsed.raw
      .split(/\r?\n/u)
      .filter((line) => !line.trim().toLowerCase().startsWith("gh-resolved"))
      .join("\n");
    await fs.writeFile(configPath, encodeUtf8(updated), { signal });
    return undefined;
  }
  for (const [name, remote] of parsed.remotes.entries()) {
    try {
      const coords = parseRepoSpec(remote.url);
      if (coords.nameWithOwner.toLowerCase() === targetRepoNameWithOwner.toLowerCase()) {
        await updateGitRemote(fs, repoRoot, name, remote.url, "base", signal);
        return coords.nameWithOwner;
      }
    } catch {
      // ignore non-github remote
    }
  }
  // If no existing remote matches, add/update origin
  await updateGitRemote(
    fs,
    repoRoot,
    "origin",
    `https://github.com/${targetRepoNameWithOwner}.git`,
    "base",
    signal
  );
  return targetRepoNameWithOwner;
}

export async function resolveRepoFromContext(
  context: CommandContext,
  explicitRepoFlag: string | undefined,
  defaultHost = "github.com",
  defaultOwner = "octocat"
): Promise<RepoCoordinates> {
  if (explicitRepoFlag) {
    return parseRepoSpec(explicitRepoFlag, defaultHost, defaultOwner);
  }
  const envRepo = context.env.GH_REPO;
  if (envRepo) {
    return parseRepoSpec(envRepo, defaultHost, defaultOwner);
  }
  const host = context.env.GH_HOST || defaultHost;
  const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
  if (gitRoot) {
    const config = await readGitConfig(context.fs, gitRoot, context.signal);
    for (const remote of config.remotes.values()) {
      if (remote.ghResolved === "base" && remote.url) {
        return parseRepoSpec(remote.url, host, defaultOwner);
      }
      if (remote.ghResolved && remote.ghResolved !== "base") {
        return parseRepoSpec(remote.ghResolved, host, defaultOwner);
      }
    }
    const upstream = config.remotes.get("upstream");
    if (upstream?.url) {
      return parseRepoSpec(upstream.url, host, defaultOwner);
    }
    const origin = config.remotes.get("origin");
    if (origin?.url) {
      return parseRepoSpec(origin.url, host, defaultOwner);
    }
    for (const remote of config.remotes.values()) {
      if (remote.url) {
        return parseRepoSpec(remote.url, host, defaultOwner);
      }
    }
  }
  throw new Error(
    "could not determine base repository: specify one with `-R OWNER/REPO` or run inside a git repository with a GitHub remote"
  );
}

export async function runGitInVfs(
  context: CommandContext,
  args: readonly string[],
  options: {
    readonly cwd?: string | undefined;
    readonly git?: CommandDefinition | CommandHandler | undefined;
    readonly stdinBytes?: Uint8Array | undefined;
  } = {}
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const cwd = options.cwd ?? context.cwd;
  let stdout = "";
  let stderr = "";
  const stdoutSink = {
    async write(bytes: Uint8Array) {
      stdout += decodeUtf8(bytes);
    },
  };
  const stderrSink = {
    async write(bytes: Uint8Array) {
      stderr += decodeUtf8(bytes);
    },
  };
  const stdinSource = (async function* () {
    if (options.stdinBytes && options.stdinBytes.length > 0) {
      yield options.stdinBytes;
    }
  })();

  const handler: CommandHandler =
    typeof options.git === "function"
      ? options.git
      : options.git && typeof options.git === "object"
        ? options.git.execute
        : getDefaultGitCommand().execute;

  const childContext: CommandContext = {
    ...context,
    command: "git",
    args: [...args],
    cwd,
    stdin: stdinSource,
    stdout: stdoutSink,
    stderr: stderrSink,
    env: {
      GIT_AUTHOR_NAME: context.env.GIT_AUTHOR_NAME ?? "Octocat",
      GIT_AUTHOR_EMAIL: context.env.GIT_AUTHOR_EMAIL ?? "octocat@github.com",
      GIT_COMMITTER_NAME: context.env.GIT_COMMITTER_NAME ?? "Octocat",
      GIT_COMMITTER_EMAIL: context.env.GIT_COMMITTER_EMAIL ?? "octocat@github.com",
      ...context.env,
    },
  };

  const result = await handler(childContext);
  return { exitCode: result.exitCode, stdout, stderr };
}

export async function readCurrentBranch(
  context: CommandContext,
  repoRoot: string,
  git?: CommandDefinition | CommandHandler
): Promise<string> {
  const headPath = `${repoRoot === "/" ? "" : repoRoot}/.git/HEAD`;
  try {
    const content = decodeUtf8(await context.fs.readFile(headPath, { signal: context.signal })).trim();
    if (content.startsWith("ref: refs/heads/")) {
      return content.slice("ref: refs/heads/".length);
    }
  } catch {
    // fallback to git rev-parse
  }
  const res = await runGitInVfs(context, ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot, git });
  if (res.exitCode === 0 && res.stdout.trim()) {
    return res.stdout.trim();
  }
  return "main";
}

export async function readHeadOid(
  context: CommandContext,
  repoRoot: string,
  git?: CommandDefinition | CommandHandler
): Promise<string> {
  const res = await runGitInVfs(context, ["rev-parse", "HEAD"], { cwd: repoRoot, git });
  if (res.exitCode === 0 && res.stdout.trim()) {
    return res.stdout.trim();
  }
  const branch = await readCurrentBranch(context, repoRoot, git);
  const refPath = `${repoRoot === "/" ? "" : repoRoot}/.git/refs/heads/${branch}`;
  try {
    return decodeUtf8(await context.fs.readFile(refPath, { signal: context.signal })).trim();
  } catch {
    return bytesToHex(sha1Sync(`head:${repoRoot}:${branch}`));
  }
}

export async function readWorktreeFiles(
  fs: FileSystem,
  rootDir: string,
  signal: AbortSignal
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (dir: string, relPrefix: string) => {
    const entries = await fs.readdir(dir, { signal });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const fullPath = dir === "/" ? `/${entry.name}` : `${dir}/${entry.name}`;
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const stat = await fs.lstat(fullPath, { signal });
      if (stat.type === "directory") {
        await walk(fullPath, relPath);
      } else if (stat.type === "file") {
        const bytes = await fs.readFile(fullPath, { signal });
        files[relPath] = decodeUtf8(bytes);
      }
    }
  };
  if (await pathExists(fs, rootDir, signal)) {
    await walk(rootDir, "");
  }
  return files;
}

export async function writeWorktreeFiles(
  fs: FileSystem,
  rootDir: string,
  files: Readonly<Record<string, string>>,
  signal: AbortSignal,
  cleanExisting = true
): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true, signal });
  if (cleanExisting) {
    const existing = await fs.readdir(rootDir, { signal });
    const removeDirRecursive = async (dirPath: string) => {
      const children = await fs.readdir(dirPath, { signal });
      for (const child of children) {
        const childFull = `${dirPath}/${child.name}`;
        const st = await fs.lstat(childFull, { signal });
        if (st.type === "directory") {
          await removeDirRecursive(childFull);
        } else if (fs.unlink) {
          await fs.unlink(childFull, { signal });
        }
      }
      if (fs.rmdir) await fs.rmdir(dirPath, { signal });
    };
    for (const entry of existing) {
      if (entry.name === ".git") continue;
      const fullPath = rootDir === "/" ? `/${entry.name}` : `${rootDir}/${entry.name}`;
      const st = await fs.lstat(fullPath, { signal });
      if (st.type === "directory") {
        await removeDirRecursive(fullPath);
      } else if (fs.unlink) {
        await fs.unlink(fullPath, { signal });
      }
    }
  }
  for (const [relPath, content] of Object.entries(files)) {
    const normalized = relPath.replace(/^\/+/u, "");
    const fullPath = rootDir === "/" ? `/${normalized}` : `${rootDir}/${normalized}`;
    const lastSlash = fullPath.lastIndexOf("/");
    if (lastSlash > 0) {
      await fs.mkdir(fullPath.slice(0, lastSlash), { recursive: true, signal });
    }
    await fs.writeFile(fullPath, encodeUtf8(content), { signal });
  }
}

export function computeDiffBetweenFileMaps(
  baseFiles: Readonly<Record<string, string>>,
  headFiles: Readonly<Record<string, string>>
): {
  readonly diff: string;
  readonly files: GhFileChange[];
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
} {
  const allPaths = Array.from(new Set([...Object.keys(baseFiles), ...Object.keys(headFiles)])).sort();
  const changes: GhFileChange[] = [];
  const patches: string[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const path of allPaths) {
    const before = baseFiles[path];
    const after = headFiles[path];
    if (before === after) continue;

    const beforeLines = before !== undefined ? (before.endsWith("\n") ? before.slice(0, -1).split("\n") : before.split("\n")) : [];
    const afterLines = after !== undefined ? (after.endsWith("\n") ? after.slice(0, -1).split("\n") : after.split("\n")) : [];

    let status: GhFileChange["status"] = "modified";
    if (before === undefined) status = "added";
    else if (after === undefined) status = "removed";

    let fileAdd = 0;
    let fileDel = 0;
    const hunkLines: string[] = [];
    if (before === undefined) {
      for (const l of afterLines) {
        hunkLines.push(`+${l}`);
        fileAdd++;
      }
    } else if (after === undefined) {
      for (const l of beforeLines) {
        hunkLines.push(`-${l}`);
        fileDel++;
      }
    } else {
      for (const l of beforeLines) {
        if (!afterLines.includes(l)) {
          hunkLines.push(`-${l}`);
          fileDel++;
        }
      }
      for (const l of afterLines) {
        if (!beforeLines.includes(l)) {
          hunkLines.push(`+${l}`);
          fileAdd++;
        } else {
          hunkLines.push(` ${l}`);
        }
      }
    }

    const oldHeader = before === undefined ? "/dev/null" : `a/${path}`;
    const newHeader = after === undefined ? "/dev/null" : `b/${path}`;
    const oldRange = before === undefined ? "0,0" : `1,${beforeLines.length}`;
    const newRange = after === undefined ? "0,0" : `1,${afterLines.length}`;
    const patchBody = `@@ -${oldRange} +${newRange} @@\n${hunkLines.join("\n")}\n`;
    const fullPatch = `diff --git a/${path} b/${path}\n--- ${oldHeader}\n+++ ${newHeader}\n${patchBody}`;

    patches.push(fullPatch);
    changes.push({
      path,
      additions: fileAdd,
      deletions: fileDel,
      status,
      patch: patchBody,
    });
    totalAdditions += fileAdd;
    totalDeletions += fileDel;
  }

  return {
    diff: patches.join(""),
    files: changes,
    additions: totalAdditions,
    deletions: totalDeletions,
    changedFiles: changes.length,
  };
}

export async function inspectLocalCommitsForPr(
  context: CommandContext,
  repoRoot: string,
  baseBranch: string,
  headBranch: string,
  git?: CommandDefinition | CommandHandler
): Promise<GhCommitRecord[]> {
  const rangeRes = await runGitInVfs(
    context,
    ["log", `${baseBranch}..${headBranch}`],
    { cwd: repoRoot, git }
  );
  const rawOutput =
    rangeRes.exitCode === 0 && rangeRes.stdout.trim()
      ? rangeRes.stdout
      : (await runGitInVfs(context, ["log", "-n", "1"], { cwd: repoRoot, git })).stdout;

  const commits: GhCommitRecord[] = [];
  const blocks = rawOutput.split(/(?=^commit [0-9a-f]{40})/mu);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed.startsWith("commit ")) continue;
    const lines = trimmed.split(/\r?\n/u);
    const oid = lines[0]!.slice("commit ".length).trim();
    let authorName = "Octocat";
    let authorEmail = "octocat@github.com";
    let msgStart = 1;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith("Author:")) {
        const m = /^Author:\s*(.+?)\s*<([^>]+)>/u.exec(line);
        if (m) {
          authorName = m[1]!.trim();
          authorEmail = m[2]!.trim();
        }
      } else if (line.trim() === "") {
        msgStart = i + 1;
        break;
      }
    }
    const msgLines = lines.slice(msgStart).map((l) => (l.startsWith("    ") ? l.slice(4) : l));
    const messageHeadline = (msgLines[0] ?? "").trim();
    const messageBody = msgLines.slice(1).join("\n").trim();
    if (!messageHeadline) continue;
    commits.push({
      oid,
      messageHeadline,
      messageBody,
      author: {
        name: authorName,
        email: authorEmail,
        login: "octocat",
      },
      committedDate: "2026-09-28T12:00:00Z",
      parents: [],
    });
  }
  return commits.reverse();
}
