import * as fs from "node:fs";
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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("bridgeActiveSkills", () => {
  let restoreRunner: () => void;

  beforeEach(() => {
    vi.restoreAllMocks();
    restoreRunner?.();
    vol.reset();
    mkdir(cwd);
    mkdir(homeDir);
    restoreRunner = setGitDirRunnerForTest(() => gitDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      /nonsense\/foo[\s\S]*agent token: nonsense[\s\S]*claude-code, codex, cursor, gemini-cli, opencode, goose/
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

  it("reports unresolved refs as a user error hinting at skill install", () => {
    const error = (() => {
      try {
        bridgeActiveSkills("opencode", cwd, ["missing"], homeDir, runId);
        return undefined;
      } catch (thrown) {
        return thrown as Error;
      }
    })();

    expect(error?.name).toBe("UserError");
    expect(error?.message).toContain("poe-code skill install");
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

  it("does not treat inherited stat error codes as missing bridge targets", async () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    const targetPath = path.join(cwd, ".opencode/skills/foo");
    const originalStatSync = fs.statSync.bind(fs);
    const stat = vi.spyOn(fs, "statSync").mockImplementation((filePath, options) => {
      if (String(filePath) === targetPath) {
        throw new Error("bridge target stat denied");
      }

      return originalStatSync(filePath, options);
    });

    try {
      await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
        expect(() => bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId)).toThrow(
          "bridge target stat denied"
        );
      });
      expect(vol.existsSync(targetPath)).toBe(false);
      expectNoExcludeFile();
    } finally {
      stat.mockRestore();
    }
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

  it("rejects a symlinked project skill source directory", () => {
    mkdir(path.join(cwd, ".poe-code/skills"));
    createSkill("/outside/foo", { "SKILL.md": "# outside\n" });
    fs.symlinkSync("/outside/foo", path.join(cwd, ".poe-code/skills/foo"));

    expect(() => bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId)).toThrow(
      /symbolic link/
    );
    expect(vol.existsSync(path.join(cwd, ".opencode/skills/foo"))).toBe(false);
  });

  it("rejects symbolic links contained inside a source skill", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"), { "SKILL.md": "# foo\n" });
    writeFile("/outside/PROMPT.md", "external prompt\n");
    fs.symlinkSync("/outside/PROMPT.md", path.join(cwd, ".poe-code/skills/foo/PROMPT.md"));

    expect(() => bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId)).toThrow(
      /symbolic link/
    );
  });

  it("rejects a symlinked spawn-agent local skill directory", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    mkdir(path.join(cwd, ".opencode"));
    mkdir("/outside/skills");
    fs.symlinkSync("/outside/skills", path.join(cwd, ".opencode/skills"));

    expect(() => bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId)).toThrow(
      /symbolic link/
    );
    expect(vol.existsSync("/outside/skills/foo")).toBe(false);
  });

  it("allows a macOS-style /var alias before the workspace root", () => {
    const aliasCwd = "/var/folders/test/repo";
    const aliasHome = "/var/folders/test/home";
    mkdir("/private/var/folders/test/repo");
    mkdir("/private/var/folders/test/home");
    fs.symlinkSync("/private/var", "/var");
    createSkill(path.join(aliasCwd, ".poe-code/skills/foo"), { "SKILL.md": "# foo\n" });

    const manifest = bridgeActiveSkills("codex", aliasCwd, ["foo"], aliasHome, runId);

    expect(manifest.entries).toHaveLength(1);
    expect(readText(path.join(aliasCwd, ".codex/skills/foo/SKILL.md"))).toBe("# foo\n");
  });

  it("rejects unsupported filesystem entries inside a source skill", () => {
    const sourcePath = path.join(cwd, ".poe-code/skills/foo");
    createSkill(sourcePath, { "SKILL.md": "# foo\n" });
    const originalReadDirSync = fs.readdirSync.bind(fs);
    const readDir = vi.spyOn(fs, "readdirSync").mockImplementation((targetPath, options) => {
      const entries = originalReadDirSync(targetPath, options);
      if (
        String(targetPath) !== sourcePath ||
        typeof options !== "object" ||
        options === null ||
        !("withFileTypes" in options) ||
        options.withFileTypes !== true
      ) {
        return entries;
      }

      return [
        ...(entries as fs.Dirent[]),
        {
          name: "events.pipe",
          isSymbolicLink: () => false,
          isDirectory: () => false,
          isFile: () => false
        } as fs.Dirent
      ] as fs.Dirent[];
    });

    try {
      expect(() => bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId)).toThrow(
        /unsupported filesystem entry/
      );
      expect(vol.existsSync(path.join(cwd, ".opencode/skills/foo"))).toBe(false);
    } finally {
      readDir.mockRestore();
    }
  });

  it("rolls back earlier copies when a later copy fails", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    createSkill(path.join(cwd, ".poe-code/skills/bar"));
    const copy = vi.spyOn(fs, "copyFileSync").mockImplementation((source, target) => {
      if (String(source).includes("/bar/")) {
        throw new Error("copy failed");
      }
      vol.writeFileSync(String(target), vol.readFileSync(String(source)));
    });

    expect(() => bridgeActiveSkills("opencode", cwd, ["foo", "bar"], homeDir, runId)).toThrow(
      "copy failed"
    );
    expect(vol.existsSync(path.join(cwd, ".opencode/skills/foo"))).toBe(false);
    expect(vol.existsSync(path.join(cwd, ".opencode/skills/bar"))).toBe(false);
    copy.mockRestore();
  });

  it("rolls back copied targets when exclude bookkeeping fails", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("exclude failed");
    });

    expect(() => bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId)).toThrow(
      "exclude failed"
    );
    expect(vol.existsSync(path.join(cwd, ".opencode/skills/foo"))).toBe(false);
    rename.mockRestore();
  });

  it("shares an already active bridged target until the last run cleans up", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));

    const first = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, "first");
    const second = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, "second");

    expect(second.entries).toHaveLength(1);
    expect(second.warnings).toEqual([]);
    cleanupBridgedSkills(first);
    expect(vol.existsSync(path.join(cwd, ".opencode/skills/foo/SKILL.md"))).toBe(true);
    cleanupBridgedSkills(second);
    expect(vol.existsSync(path.join(cwd, ".opencode/skills/foo/SKILL.md"))).toBe(false);
  });

  it("does not reuse an active target after the source skill changes", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"), { "SKILL.md": "# foo v1\n" });

    const first = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, "first");
    writeFile(path.join(cwd, ".poe-code/skills/foo/SKILL.md"), "# foo v2\n");
    const second = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, "second");

    expect(second.entries).toEqual([]);
    expect(second.warnings).toMatchObject([
      {
        kind: "local-collision",
        ref: "foo",
        conflictingPath: path.join(cwd, ".opencode/skills/foo")
      }
    ]);
    cleanupBridgedSkills(first);
  });

  it("uses independent exclude blocks for overlapping identical run ids", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    createSkill(path.join(cwd, ".poe-code/skills/bar"));

    const first = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, "same");
    const second = bridgeActiveSkills("opencode", cwd, ["bar"], homeDir, "same");
    cleanupBridgedSkills(first);

    expect(readText(excludePath)).toContain(".opencode/skills/bar");
    expect(vol.existsSync(second.entries[0]!.targetPath)).toBe(true);
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

  it("does not treat inherited rmdir error codes as empty created parents", async () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    const manifest = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId);
    const parentPath = path.join(cwd, ".opencode/skills");
    const originalRmdirSync = fs.rmdirSync.bind(fs);
    const rmdir = vi.spyOn(fs, "rmdirSync").mockImplementation((targetPath, options) => {
      if (String(targetPath) === parentPath) {
        throw new Error("parent cleanup denied");
      }

      return originalRmdirSync(targetPath, options);
    });

    try {
      await withObjectPrototypeProperties({ code: "ENOTEMPTY" }, async () => {
        expect(() => cleanupBridgedSkills(manifest)).toThrow("parent cleanup denied");
      });
    } finally {
      rmdir.mockRestore();
    }
  });

  it("cleanup preserves a user replacement at a prior bridge target", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"), { "SKILL.md": "# bridge\n" });
    const manifest = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId);
    const target = path.join(cwd, ".opencode/skills/foo");
    vol.rmSync(target, { recursive: true });
    createSkill(target, { "SKILL.md": "# replacement\n" });

    cleanupBridgedSkills(manifest);

    expect(readText(path.join(target, "SKILL.md"))).toBe("# replacement\n");
  });

  it("leaves bridged targets intact when exclude cleanup cannot be saved", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    const manifest = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId);
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("exclude cleanup failed");
    });

    expect(() => cleanupBridgedSkills(manifest)).toThrow("exclude cleanup failed");
    expect(vol.existsSync(path.join(cwd, ".opencode/skills/foo/SKILL.md"))).toBe(true);
    expect(readText(excludePath)).toContain(".opencode/skills/foo");
    rename.mockRestore();
  });

  it("cleanup is idempotent", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    const manifest = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, runId);

    cleanupBridgedSkills(manifest);
    cleanupBridgedSkills(manifest);

    expect(vol.existsSync(path.join(cwd, ".opencode"))).toBe(false);
    expect(readText(excludePath)).toBe("");
  });

  it("duplicate-id cleanup remains idempotent while another block is live", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    createSkill(path.join(cwd, ".poe-code/skills/bar"));
    const first = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, "same");
    const second = bridgeActiveSkills("opencode", cwd, ["bar"], homeDir, "same");

    cleanupBridgedSkills(second);
    cleanupBridgedSkills(second);

    expect(readText(excludePath)).toContain(".opencode/skills/foo");
    cleanupBridgedSkills(first);
  });

  it("cleanup removes duplicate-run exclude blocks after a manifest is cloned", () => {
    createSkill(path.join(cwd, ".poe-code/skills/foo"));
    createSkill(path.join(cwd, ".poe-code/skills/bar"));
    const first = bridgeActiveSkills("opencode", cwd, ["foo"], homeDir, "same");
    const second = bridgeActiveSkills("opencode", cwd, ["bar"], homeDir, "same");
    const clonedSecond = JSON.parse(JSON.stringify(second));

    cleanupBridgedSkills(clonedSecond);

    expect(readText(excludePath)).not.toContain(".opencode/skills/bar");
    expect(readText(excludePath)).toContain(".opencode/skills/foo");
    cleanupBridgedSkills(first);
  });
});
