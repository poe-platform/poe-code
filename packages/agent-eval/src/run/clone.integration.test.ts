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
  sourceRepo: string;
  bareRepo: string;
  headSha: string;
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
  const sourceRepo = path.join(root, "source");
  const bareRepo = path.join(root, "fixture.git");
  await mkdir(sourceRepo);

  const git = simpleGit(sourceRepo);
  await git.init();
  await git.addConfig("user.name", "Agent Eval Test");
  await git.addConfig("user.email", "agent-eval@example.com");
  await git.branch(["-M", "main"]);

  await writeFile(path.join(sourceRepo, "README.md"), "first\n");
  await git.add("README.md");
  await git.commit("first");

  await writeFile(path.join(sourceRepo, "README.md"), "second\n");
  await git.add("README.md");
  await git.commit("second");

  const headSha = (await git.revparse(["HEAD"])).trim();
  await simpleGit(root).clone(sourceRepo, bareRepo, ["--bare"]);

  return { sourceRepo, bareRepo, headSha };
}

async function copyFixtureRepo(root: string): Promise<FixtureRepo> {
  const sourceRepo = path.join(root, "source");
  const bareRepo = path.join(root, "fixture.git");
  await Promise.all([
    cp(fixtureTemplate.sourceRepo, sourceRepo, { recursive: true }),
    cp(fixtureTemplate.bareRepo, bareRepo, { recursive: true })
  ]);
  return { sourceRepo, bareRepo, headSha: fixtureTemplate.headSha };
}

async function commitFixtureChange(
  sourceRepo: string,
  fileName: string,
  contents: string,
  message: string
): Promise<string> {
  const git = simpleGit(sourceRepo);
  await writeFile(path.join(sourceRepo, fileName), contents);
  await git.add(fileName);
  await git.commit(message);

  return (await git.revparse(["HEAD"])).trim();
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

  it("reuses a cached bare repo across new and previously deleted worktree destinations", async () => {
    const root = await tempRoot();
    const cacheDir = path.join(root, "cache");
    const secondDest = path.join(root, "second");

    await expect(
      cloneTarget({
        repo: fixtureTemplate.bareRepo,
        ref: "main",
        dest: path.join(root, "first"),
        cacheDir
      })
    ).resolves.toEqual({ resolvedSha: fixtureTemplate.headSha });

    await expect(
      cloneTarget({
        repo: fixtureTemplate.bareRepo,
        ref: "main",
        dest: secondDest,
        cacheDir
      })
    ).resolves.toEqual({ resolvedSha: fixtureTemplate.headSha });

    await rm(secondDest, { recursive: true, force: true });

    await expect(
      cloneTarget({
        repo: fixtureTemplate.bareRepo,
        ref: "main",
        dest: secondDest,
        cacheDir
      })
    ).resolves.toEqual({ resolvedSha: fixtureTemplate.headSha });

    const cachedRepos = await readdir(cacheDir);
    expect(cachedRepos).toHaveLength(1);
    expect(cachedRepos[0]?.endsWith(".git")).toBe(true);
  });

  it("fetches cached bare repos before creating later worktrees", async () => {
    const root = await tempRoot();
    const fixture = await copyFixtureRepo(root);
    const cacheDir = path.join(root, "cache");

    await expect(
      cloneTarget({
        repo: fixture.bareRepo,
        ref: "main",
        dest: path.join(root, "first"),
        cacheDir
      })
    ).resolves.toEqual({ resolvedSha: fixture.headSha });

    const updatedSha = await commitFixtureChange(
      fixture.sourceRepo,
      "README.md",
      "third\n",
      "third"
    );
    await simpleGit(fixture.sourceRepo).push(fixture.bareRepo, "main");

    await expect(
      cloneTarget({
        repo: fixture.bareRepo,
        ref: "main",
        dest: path.join(root, "second"),
        cacheDir
      })
    ).resolves.toEqual({ resolvedSha: updatedSha });
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
