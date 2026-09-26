import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, cp, chmod, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { cloneTarget } from "./clone.js";

const execFileAsync = promisify(execFile);

interface FixtureRepo {
  bareRepo: string;
  updatedRepo: string;
  headSha: string;
  updatedSha: string;
}

let roots: string[] = [];
let fixtureRoot: string;
let fixtureTemplate: FixtureRepo;

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-eval-clone-"));
  roots.push(root);
  return root;
}

async function createFixtureRepo(root: string): Promise<FixtureRepo> {
  const bareRepo = path.join(root, "fixture.git");
  const updatedRepo = path.join(root, "updated.git");
  await mkdir(bareRepo);
  const git = simpleGit(bareRepo);
  await git.raw(["init", "--bare", "--initial-branch=main"]);
  const commit = (message: string, mark: number, parent?: string) => [
    "commit refs/heads/main",
    `mark :${mark}`,
    "committer Agent Eval Test <agent-eval@example.com> 0 +0000",
    `data ${message.length}`,
    message,
    ...(parent ? [`from ${parent}`] : []),
    "M 100644 inline README.md",
    `data ${message.length + 1}`,
    message,
    ""
  ].join("\n");
  const initial = execFileAsync("git", ["fast-import", "--quiet"], { cwd: bareRepo });
  initial.child.stdin!.end(commit("first", 1) + commit("second", 2, ":1"));
  await initial;
  const headSha = (await git.revparse(["HEAD"])).trim();
  // Keep the later commit outside the original remote so fetching must transfer it.
  await cp(bareRepo, updatedRepo, { recursive: true });
  const updated = execFileAsync("git", ["fast-import", "--quiet"], { cwd: updatedRepo });
  updated.child.stdin!.end(commit("third", 3, headSha));
  await updated;
  const updatedSha = (await simpleGit(updatedRepo).revparse(["HEAD"])).trim();
  return { bareRepo, updatedRepo, headSha, updatedSha };
}

async function copyFixtureRepo(root: string): Promise<FixtureRepo> {
  const bareRepo = path.join(root, "fixture.git");
  await execFileAsync("git", ["clone", "--quiet", "--bare", "--shared", fixtureTemplate.bareRepo, bareRepo]);
  return { ...fixtureTemplate, bareRepo };
}

async function expectMissing(target: string): Promise<void> {
  await expect(access(target)).rejects.toThrow();
}

describe("cloneTarget", () => {
  beforeAll(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "agent-eval-clone-template-"));
    fixtureTemplate = await createFixtureRepo(fixtureRoot);
  });

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    roots = [];
  });

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  it("clones a ref and returns the resolved HEAD sha", async () => {
    const root = await tempRoot();
    const dest = path.join(root, "clone");

    const result = await cloneTarget({
      repo: fixtureTemplate.bareRepo,
      ref: "main",
      dest
    });

    expect(result.resolvedSha).toBe(fixtureTemplate.headSha);
    await expect(simpleGit(dest).revparse(["HEAD"])).resolves.toBe(fixtureTemplate.headSha);
  });

  describe("cached repository reuse", () => {
    let root: string;
    let cacheDir: string;
    let firstDest: string;
    let secondDest: string;

    beforeAll(async () => {
      root = await mkdtemp(path.join(tmpdir(), "agent-eval-clone-reuse-"));
      cacheDir = path.join(root, "cache");
      firstDest = path.join(root, "first");
      secondDest = path.join(root, "second");
      await expect(cloneTarget({
        repo: fixtureTemplate.bareRepo,
        ref: "main",
        dest: firstDest,
        cacheDir
      })).resolves.toEqual({ resolvedSha: fixtureTemplate.headSha });
    }, 5000);

    afterAll(async () => {
      if (root) await rm(root, { recursive: true, force: true });
    });

    it("reuses a cached bare repo for a new worktree destination", async () => {
      await expect(cloneTarget({
        repo: fixtureTemplate.bareRepo,
        ref: "main",
        dest: secondDest,
        cacheDir
      })).resolves.toEqual({ resolvedSha: fixtureTemplate.headSha });

      const cachedRepos = await readdir(cacheDir);
      expect(cachedRepos).toHaveLength(1);
      expect(cachedRepos[0]?.endsWith(".git")).toBe(true);
    }, 5000);

    it("reuses a cached bare repo after its worktree destination is deleted", async () => {
      await rm(firstDest, { recursive: true, force: true });

      await expect(cloneTarget({
        repo: fixtureTemplate.bareRepo,
        ref: "main",
        dest: firstDest,
        cacheDir
      })).resolves.toEqual({ resolvedSha: fixtureTemplate.headSha });

      const cachedRepos = await readdir(cacheDir);
      expect(cachedRepos).toHaveLength(1);
      expect(cachedRepos[0]?.endsWith(".git")).toBe(true);
    }, 5000);
  });

  describe("cached repository updates", () => {
    let root: string;
    let fixture: FixtureRepo;
    let cacheDir: string;
    let updatedSha: string;

    beforeAll(async () => {
      root = await mkdtemp(path.join(tmpdir(), "agent-eval-clone-update-"));
      fixture = await copyFixtureRepo(root);
      cacheDir = path.join(root, "cache");
      await expect(cloneTarget({
        repo: fixture.bareRepo,
        ref: "main",
        dest: path.join(root, "first"),
        cacheDir
      })).resolves.toEqual({ resolvedSha: fixture.headSha });

      updatedSha = fixture.updatedSha;
      await simpleGit(fixture.updatedRepo).push(fixture.bareRepo, "main");
    }, 5000);

    afterAll(async () => {
      if (root) await rm(root, { recursive: true, force: true });
    });

    it("fetches cached bare repos before creating later worktrees", async () => {
      await expect(cloneTarget({
        repo: fixture.bareRepo,
        ref: "main",
        dest: path.join(root, "second"),
        cacheDir
      })).resolves.toEqual({ resolvedSha: updatedSha });
    }, 5000);
  });

  it("cleans up the destination when an in-flight clone is aborted", async () => {
    const root = await tempRoot();
    const wrapperDir = path.join(root, "bin");
    const dest = path.join(root, "aborted");
    const originalPath = process.env.PATH;
    const originalRealGit = process.env.REAL_GIT;
    const realGit = (await execFileAsync("sh", ["-c", "command -v git"])).stdout.trim();

    await mkdir(wrapperDir);
    await writeFile(
      path.join(wrapperDir, "git"),
      [
        "#!/bin/sh",
        'if [ "$1" = "clone" ]; then',
        '  dest=""',
        '  for arg in "$@"; do dest="$arg"; done',
        '  mkdir -p "$dest/.git"',
        "  sleep 2",
        "fi",
        'exec "$REAL_GIT" "$@"',
        ""
      ].join("\n")
    );
    await chmod(path.join(wrapperDir, "git"), 0o755);

    process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath ?? ""}`;
    process.env.REAL_GIT = realGit;

    try {
      const controller = new AbortController();
      const pending = cloneTarget({
        repo: fixtureTemplate.bareRepo,
        ref: "main",
        dest,
        signal: controller.signal
      });

      setTimeout(() => controller.abort(), 50);

      await expect(pending).rejects.toThrow();
      await expectMissing(dest);
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }

      if (originalRealGit === undefined) {
        delete process.env.REAL_GIT;
      } else {
        process.env.REAL_GIT = originalRealGit;
      }
    }
  });
});
