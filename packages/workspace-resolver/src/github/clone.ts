import path from "node:path";
import { UserError } from "@poe-code/user-error";
import { assertPathHasNoSymbolicLinks } from "../path-safety.js";
import type { ParsedLocator, WorkspaceResolverOptions } from "../types.js";

/**
 * Recognisable `git clone` failures that are the user's to fix. Anything absent
 * from this table stays a system error so genuine git bugs keep their detail.
 */
const cloneFailures: { matches: RegExp; describe: (locator: string) => string }[] = [
  {
    matches: /repository not found|does not exist|not found/i,
    describe: (locator) =>
      `Cannot clone ${locator}: the repository does not exist or your account cannot see it. Check the owner and repository name, and confirm you have access if it is private.`
  },
  {
    matches: /authentication failed|could not read username|permission denied|terminal prompts disabled|invalid username or password/i,
    describe: (locator) =>
      `Cannot clone ${locator}: GitHub rejected your credentials. Run 'gh auth login', or configure a credential helper with access to this repository.`
  },
  {
    matches: /could not resolve host|failed to connect|connection timed out|network is unreachable|unable to access/i,
    describe: (locator) =>
      `Cannot clone ${locator}: GitHub is unreachable. Check your network connection or proxy settings and try again.`
  }
];

export function buildCachePath(
  homeDir: string,
  locator: Extract<ParsedLocator, { scheme: "github" }>
): string {
  return path.join(
    homeDir,
    ".poe-code",
    "workspaces",
    "github",
    `${locator.owner.length.toString(36)}-${locator.owner}-${locator.repo}`
  );
}

export function buildCloneUrl(locator: Extract<ParsedLocator, { scheme: "github" }>): string {
  return `https://github.com/${locator.owner}/${locator.repo}.git`;
}

export async function cloneOrUpdate(
  locator: Extract<ParsedLocator, { scheme: "github" }>,
  options: WorkspaceResolverOptions
): Promise<string> {
  const cacheDir = buildCachePath(options.homeDir, locator);
  await assertPathHasNoSymbolicLinks(options.fs, cacheDir);
  const exists = await pathExists(options.fs, cacheDir);

  if (!exists) {
    await options.fs.mkdir(path.dirname(cacheDir), { recursive: true });
    await assertPathHasNoSymbolicLinks(options.fs, cacheDir);
    assertCloneSuccess(
      await options.exec("git", ["clone", "--depth", "1", buildCloneUrl(locator), cacheDir]),
      locator
    );
  } else {
    const statusResult = await options.exec("git", ["status", "--porcelain"], { cwd: cacheDir });
    assertExecSuccess(statusResult, "git status failed");
    if (statusResult.exitCode === 0 && statusResult.stdout.trim().length === 0) {
      await assertExecSuccess(
        await options.exec("git", ["pull", "--ff-only"], { cwd: cacheDir }),
        "git pull failed"
      );
    }
  }

  if (locator.ref) {
    await fetchRef(cacheDir, locator.ref, options);
    await assertExecSuccess(
      await options.exec("git", ["checkout", "FETCH_HEAD", "--"], { cwd: cacheDir }),
      "git checkout failed"
    );
  }

  return cacheDir;
}

export async function fetchRef(
  cacheDir: string,
  ref: string,
  options: WorkspaceResolverOptions
): Promise<void> {
  await assertExecSuccess(
    await options.exec("git", ["fetch", "origin", "--", ref], { cwd: cacheDir }),
    "git fetch failed"
  );
}

async function pathExists(
  fs: WorkspaceResolverOptions["fs"],
  target: string
): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function assertExecSuccess(
  result: Awaited<ReturnType<WorkspaceResolverOptions["exec"]>>,
  fallback: string
): void {
  if (result.exitCode === 0) {
    return;
  }

  const detail = result.stderr.trim() || result.stdout.trim() || fallback;
  throw new Error(detail);
}

function assertCloneSuccess(
  result: Awaited<ReturnType<WorkspaceResolverOptions["exec"]>>,
  locator: Extract<ParsedLocator, { scheme: "github" }>
): void {
  if (result.exitCode === 0) {
    return;
  }

  const detail = `${result.stderr}\n${result.stdout}`;
  const failure = cloneFailures.find((candidate) => candidate.matches.test(detail));
  if (failure === undefined) {
    assertExecSuccess(result, "git clone failed");
    return;
  }

  const guidance = failure.describe(`github://${locator.owner}/${locator.repo}`);
  const reason = summarizeGitFailure(detail);
  throw new UserError(reason === "" ? guidance : `${guidance} git reported: ${reason}`);
}

/**
 * Keeps the lines where git states the reason and drops progress chatter such as
 * "Cloning into '...'", so the recovery guidance stays the headline.
 */
function summarizeGitFailure(detail: string): string {
  const lines = detail
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const reasons = lines.filter((line) => /^(error|fatal|remote):/i.test(line));

  return (reasons.length > 0 ? reasons : lines).join(" ");
}
