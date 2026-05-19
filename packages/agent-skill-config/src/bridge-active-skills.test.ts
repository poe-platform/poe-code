import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { bridgeActiveSkills, cleanupBridgedSkills } = await import("./bridge-active-skills.js");
const { setGitDirRunnerForTest } = await import("./git-exclude.js");

const cwd = "/repo";
const homeDir = "/home/test";
const runId = "run-1";
const gitDir = path.join(cwd, ".git");
const excludePath = path.join(gitDir, "info/exclude");

function mkdir(targetPath: string): void {
  vol.mkdirSync(targetPath, { recursive: true });
}

function writeFile(targetPath: string, content: string | Uint8Array): void {
  mkdir(path.dirname(targetPath));
  vol.writeFileSync(targetPath, content);
}

function createSkill(skillPath: string, files: Record<string, string | Uint8Array> = {}): void {
  mkdir(skillPath);
  const entries = Object.entries(files);
  if (entries.length === 0) {
    writeFile(path.join(skillPath, "SKILL.md"), `# ${path.basename(skillPath)}\n`);
    return;
  }

  for (const [relativePath, content] of entries) {
    writeFile(path.join(skillPath, relativePath), content);
  }
}

function readText(targetPath: string): string {
  return vol.readFileSync(targetPath, "utf8") as string;
}

function expectNoExcludeFile(): void {
  expect(vol.existsSync(excludePath)).toBe(false);
}

describe("bridgeActiveSkills", () => {
  let restoreRunner: () => void;

  beforeEach(() => {
    restoreRunner?.();
    vol.reset();
    mkdir(cwd);
    mkdir(homeDir);
    restoreRunner = setGitDirRunnerForTest(() => gitDir);
  });

  afterEach(() => {
    restoreRunner?.();
  });

  it("bridges bare and agent-prefixed refs together into the spawning agent local dir", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"), { "SKILL.md": "# foo\n" });
    createSkill(path.join(cwd, ".claude/skills/bar"), { "SKILL.md": "# bar\n" });

    const manifest = bridgeActiveSkills("opencode", cwd, ["foo", "claude/bar"], homeDir, runId);

    expect(manifest).toEqual({
      spawnAgentId: "opencode",
      cwd,
      runId,
      entries: [
        {
          ref: "foo",
          sourcePath: path.join(cwd, ".poe-code/skills/foo"),
          targetPath: path.join(cwd, ".opencode/skills/foo"),
          createdParents: [path.join(cwd, ".opencode"), path.join(cwd, ".opencode/skills")]
        },
        {
          ref: "claude/bar",
          sourcePath: path.join(cwd, ".claude/skills/bar"),
          targetPath: path.join(cwd, ".opencode/skills/bar"),
          createdParents: []
        }
      ],
      warnings: []
    });
    expect(readText(path.join(cwd, ".opencode/skills/foo/SKILL.md"))).toBe("# foo\n");
    expect(readText(path.join(cwd, ".opencode/skills/bar/SKILL.md"))).toBe("# bar\n");
  });

  it("treats alias and canonical prefixes identically for target computation", () => {
    createSkill(path.join(cwd, ".claude/skills/bar"));

    const alias = bridgeActiveSkills("opencode", cwd, ["claude/bar"], homeDir, "alias-run");
    cleanupBridgedSkills(alias);
    const canonical = bridgeActiveSkills(
      "opencode",
      cwd,
      ["claude-code/bar"],
      homeDir,
      "canon-run"
    );

    expect(alias.entries[0]?.targetPath).toBe(path.join(cwd, ".opencode/skills/bar"));
    expect(canonical.entries[0]?.targetPath).toBe(path.join(cwd, ".opencode/skills/bar"));
    expect(alias.entries[0]?.sourcePath).toBe(canonical.entries[0]?.sourcePath);
  });

  it("aborts unknown-agent resolution failures before mutating the filesystem", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));

    expect(() =>
      bridgeActiveSkills("opencode", cwd, ["foo", "nonsense/foo"], homeDir, runId)
    ).toThrow(
      /nonsense\/foo[\s\S]*agent token: nonsense[\s\S]*claude-code, codex, opencode, goose/
    );
    expect(vol.existsSync(path.join(cwd, ".opencode"))).toBe(false);
    expectNoExcludeFile();
  });

  it("aborts malformed refs with the expected syntax in the error", () => {
    expect(() => bridgeActiveSkills("opencode", cwd, ["a/b/c"], homeDir, runId)).toThrow(
      /Malformed[\s\S]*a\/b\/c[\s\S]*"<name>" or "<agentId>\/<name>"/
    );
  });

  it("aborts not-found refs and lists searched paths in resolver order", () => {
    expect(() => bridgeActiveSkills("opencode", cwd, ["missing"], homeDir, runId)).toThrow(
      new RegExp(
        [
          "Not found",
          "missing",
          path.join(cwd, ".poe-code/skills/missing").replaceAll("/", "\\/"),
          path.join(homeDir, ".poe-code/skills/missing").replaceAll("/", "\\/")
        ].join("[\\s\\S]*")
      )
    );
  });

  it("groups malformed, unknown-agent, and not-found failures into one error", () => {
    expect(() =>
      bridgeActiveSkills("opencode", cwd, ["a/b/c", "nonsense/foo", "missing"], homeDir, runId)
    ).toThrow(
      /Malformed[\s\S]*a\/b\/c[\s\S]*Unknown agent[\s\S]*nonsense\/foo[\s\S]*Not found[\s\S]*missing/
    );
  });

  it("resolution failure leaves no bridged files and no exclude block", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));

    expect(() => bridgeActiveSkills("opencode", cwd, ["foo", "missing"], homeDir, runId)).toThrow();

    expect(vol.existsSync(path.join(cwd, ".opencode/skills/foo"))).toBe(false);
    expectNoExcludeFile();
  });

  it("warns and skips local target collisions while bridging the rest", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"), { "SKILL.md": "# source\n" });
    createSkill(path.join(cwd, ".poe-code/skills/bar"), { "SKILL.md": "# bar\n" });
    createSkill(path.join(cwd, ".opencode/skills/foo"), { "SKILL.md": "# local\n" });

    const manifest = bridgeActiveSkills("opencode", cwd, ["foo", "bar"], homeDir, runId);

    expect(manifest.entries.map((entry) => entry.ref)).toEqual(["bar"]);
    expect(manifest.warnings).toMatchObject([
      {
        kind: "local-collision",
        ref: "foo",
        sourcePath: path.join(cwd, ".poe-code/skills/foo"),
        conflictingPath: path.join(cwd, ".opencode/skills/foo")
      }
    ]);
    expect(readText(path.join(cwd, ".opencode/skills/foo/SKILL.md"))).toBe("# local\n");
    expect(readText(path.join(cwd, ".opencode/skills/bar/SKILL.md"))).toBe("# bar\n");
  });

  it("warns and skips global target collisions", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    createSkill(path.join(homeDir, ".config/opencode/skills/foo"));

    const manifest = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId);

    expect(manifest.entries).toEqual([]);
    expect(manifest.warnings).toMatchObject([
      {
        kind: "global-collision",
        ref: "foo",
        conflictingPath: path.join(homeDir, ".config/opencode/skills/foo")
      }
    ]);
  });

  it("lets the first intra-batch basename win and warns for later collisions", () => {
    createSkill(path.join(cwd, ".claude/skills/foo"), { "SKILL.md": "# claude\n" });
    createSkill(path.join(cwd, ".codex/skills/foo"), { "SKILL.md": "# codex\n" });

    const manifest = bridgeActiveSkills(
      "opencode",
      cwd,
      ["claude/foo", "codex/foo"],
      homeDir,
      runId
    );

    expect(manifest.entries.map((entry) => entry.ref)).toEqual(["claude/foo"]);
    expect(manifest.warnings).toMatchObject([
      {
        kind: "intra-batch-collision",
        ref: "codex/foo",
        conflictingPath: path.join(cwd, ".opencode/skills/foo")
      }
    ]);
    expect(readText(path.join(cwd, ".opencode/skills/foo/SKILL.md"))).toBe("# claude\n");
  });

  it("warns self-reference before global collision for native prefixed refs", () => {
    createSkill(path.join(homeDir, ".claude/skills/foo"));

    const manifest = bridgeActiveSkills("claude-code", cwd, ["claude/foo"], homeDir, runId);

    expect(manifest.entries).toEqual([]);
    expect(manifest.warnings).toMatchObject([
      {
        kind: "self-reference",
        ref: "claude/foo",
        conflictingPath: path.join(homeDir, ".claude/skills/foo")
      }
    ]);
  });

  it("accounts for every ref exactly once across entries and warnings in mixed batches", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    createSkill(path.join(cwd, ".poe-code/skills/bar"));
    createSkill(path.join(cwd, ".opencode/skills/bar"));

    const refs = ["foo", "bar"];
    const manifest = bridgeActiveSkills("opencode", cwd, refs, homeDir, runId);

    expect([
      ...manifest.entries.map((entry) => entry.ref),
      ...manifest.warnings.map((w) => w.ref)
    ]).toEqual(refs);
  });

  it("writes exclude entries only for successfully bridged targets", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    createSkill(path.join(cwd, ".poe-code/skills/bar"));
    createSkill(path.join(cwd, ".opencode/skills/bar"));

    bridgeActiveSkills("opencode", cwd, ["foo", "bar"], homeDir, runId);

    expect(readText(excludePath)).toBe(
      [
        "# poe-code-spawn-skills:run-1 begin",
        ".opencode/skills/foo",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );
  });

  it("records only parent directories created by the bridge call", () => {
    mkdir(path.join(cwd, ".opencode"));
    createSkill(path.join(cwd, ".poe-code/skills/foo"));

    const manifest = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId);

    expect(manifest.entries[0]?.createdParents).toEqual([path.join(cwd, ".opencode/skills")]);
  });

  it("copies nested subdirectories and binary contents", () => {
    const binary = Uint8Array.from([0, 1, 2, 255]);
    createSkill(path.join(cwd, ".poe-code/skills/foo"), {
      "nested/deep/SKILL.md": "# nested\n",
      "assets/blob.bin": binary
    });

    bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId);

    expect(readText(path.join(cwd, ".opencode/skills/foo/nested/deep/SKILL.md"))).toBe(
      "# nested\n"
    );
    expect(
      Buffer.from(vol.readFileSync(path.join(cwd, ".opencode/skills/foo/assets/blob.bin")))
    ).toEqual(Buffer.from(binary));
  });

  it("cleanup removes targets and empty created parents", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    const manifest = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId);

    cleanupBridgedSkills(manifest);

    expect(vol.existsSync(path.join(cwd, ".opencode/skills/foo"))).toBe(false);
    expect(vol.existsSync(path.join(cwd, ".opencode/skills"))).toBe(false);
    expect(vol.existsSync(path.join(cwd, ".opencode"))).toBe(false);
    expect(readText(excludePath)).toBe("");
  });

  it("cleanup leaves a created parent when a user added a sibling file inside it", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    const manifest = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId);
    writeFile(path.join(cwd, ".opencode/skills/manual.md"), "# manual\n");

    cleanupBridgedSkills(manifest);

    expect(vol.existsSync(path.join(cwd, ".opencode/skills/foo"))).toBe(false);
    expect(readText(path.join(cwd, ".opencode/skills/manual.md"))).toBe("# manual\n");
    expect(vol.existsSync(path.join(cwd, ".opencode/skills"))).toBe(true);
  });

  it("cleanup is idempotent", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    const manifest = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId);

    cleanupBridgedSkills(manifest);
    cleanupBridgedSkills(manifest);

    expect(vol.existsSync(path.join(cwd, ".opencode"))).toBe(false);
    expect(readText(excludePath)).toBe("");
  });
});
