import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const nodeFs = await import("node:fs");
const { resolveSkillReference } = await import("./resolve-skill-reference.js");

const cwd = "/repo";
const homeDir = "/home/test";
const nativeProjectSkill = path.resolve(cwd, ".poe-code/skills/foo");
const nativeUserSkill = path.resolve(homeDir, ".poe-code/skills/foo");
const claudeProjectSkill = path.resolve(cwd, ".claude/skills/foo");
const claudeUserSkill = path.resolve(homeDir, ".claude/skills/foo");

function mkdir(targetPath: string): void {
  vol.mkdirSync(targetPath, { recursive: true });
}

describe("resolveSkillReference", () => {
  beforeEach(() => {
    vol.reset();
    mkdir(cwd);
    mkdir(homeDir);
  });

  it("resolves bare refs from the project tier", () => {
    mkdir(nativeProjectSkill);

    expect(resolveSkillReference("foo", cwd, homeDir)).toEqual({
      kind: "resolved",
      ref: "foo",
      name: "foo",
      sourcePath: nativeProjectSkill,
      scope: "project"
    });
  });

  it("resolves bare refs from the user tier", () => {
    mkdir(nativeUserSkill);

    expect(resolveSkillReference("foo", cwd, homeDir)).toEqual({
      kind: "resolved",
      ref: "foo",
      name: "foo",
      sourcePath: nativeUserSkill,
      scope: "user"
    });
  });

  it("resolves bare refs from project before user", () => {
    mkdir(nativeProjectSkill);
    mkdir(nativeUserSkill);

    expect(resolveSkillReference("foo", cwd, homeDir)).toMatchObject({
      kind: "resolved",
      sourcePath: nativeProjectSkill,
      scope: "project"
    });
  });

  it("throws project skill stat errors instead of falling back to user scope", () => {
    mkdir(nativeUserSkill);
    const originalStatSync = nodeFs.statSync.bind(nodeFs);
    const stat = vi.spyOn(nodeFs, "statSync").mockImplementation((targetPath, options) => {
      if (String(targetPath) === nativeProjectSkill) {
        throw new Error("project skill stat denied");
      }

      return originalStatSync(targetPath, options);
    });

    try {
      expect(() => resolveSkillReference("foo", cwd, homeDir)).toThrow(
        "project skill stat denied"
      );
    } finally {
      stat.mockRestore();
    }
  });

  it("returns not-found for bare refs with searched paths in lookup order", () => {
    expect(resolveSkillReference("foo", cwd, homeDir)).toEqual({
      kind: "not-found",
      ref: "foo",
      searchedPaths: [nativeProjectSkill, nativeUserSkill]
    });
  });

  it("does not resolve bare refs to files", () => {
    vol.mkdirSync(path.dirname(nativeProjectSkill), { recursive: true });
    vol.writeFileSync(nativeProjectSkill, "not a directory");

    expect(resolveSkillReference("foo", cwd, homeDir)).toEqual({
      kind: "not-found",
      ref: "foo",
      searchedPaths: [nativeProjectSkill, nativeUserSkill]
    });
  });

  it("treats bare skill names as case-sensitive", () => {
    mkdir(nativeProjectSkill);

    expect(resolveSkillReference("Foo", cwd, homeDir)).toEqual({
      kind: "not-found",
      ref: "Foo",
      searchedPaths: [
        path.resolve(cwd, ".poe-code/skills/Foo"),
        path.resolve(homeDir, ".poe-code/skills/Foo")
      ]
    });
  });

  it("resolves prefixed canonical ids from the agent skill dir", () => {
    mkdir(claudeProjectSkill);

    expect(resolveSkillReference("claude-code/foo", cwd, homeDir)).toEqual({
      kind: "resolved",
      ref: "claude-code/foo",
      name: "foo",
      sourceAgentId: "claude-code",
      sourcePath: claudeProjectSkill,
      scope: "project"
    });
  });

  it("resolves prefixed aliases to the same canonical id and paths as canonical refs", () => {
    mkdir(claudeProjectSkill);

    const canonical = resolveSkillReference("claude-code/foo", cwd, homeDir);
    const alias = resolveSkillReference("claude/foo", cwd, homeDir);

    expect(alias).toMatchObject({
      kind: "resolved",
      ref: "claude/foo",
      sourceAgentId: "claude-code",
      sourcePath: claudeProjectSkill
    });
    expect(alias.kind === "resolved" ? alias.sourcePath : undefined).toBe(
      canonical.kind === "resolved" ? canonical.sourcePath : undefined
    );
  });

  it("reports the same prefixed searched paths for aliases and canonical refs", () => {
    const canonical = resolveSkillReference("claude-code/foo", cwd, homeDir);
    const alias = resolveSkillReference("claude/foo", cwd, homeDir);

    expect(alias).toEqual({
      kind: "not-found",
      ref: "claude/foo",
      searchedPaths: canonical.kind === "not-found" ? canonical.searchedPaths : []
    });
  });

  it("resolves mixed-case aliases identically", () => {
    mkdir(claudeProjectSkill);

    const lower = resolveSkillReference("claude/foo", cwd, homeDir);
    const title = resolveSkillReference("Claude/foo", cwd, homeDir);
    const upper = resolveSkillReference("CLAUDE/foo", cwd, homeDir);

    expect(title).toMatchObject({
      kind: "resolved",
      sourceAgentId: "claude-code",
      sourcePath: lower.kind === "resolved" ? lower.sourcePath : undefined
    });
    expect(upper).toMatchObject({
      kind: "resolved",
      sourceAgentId: "claude-code",
      sourcePath: lower.kind === "resolved" ? lower.sourcePath : undefined
    });
  });

  it("resolves prefixed refs from the project tier", () => {
    mkdir(claudeProjectSkill);

    expect(resolveSkillReference("claude/foo", cwd, homeDir)).toMatchObject({
      kind: "resolved",
      sourceAgentId: "claude-code",
      sourcePath: claudeProjectSkill,
      scope: "project"
    });
  });

  it("resolves prefixed refs from the user tier", () => {
    mkdir(claudeUserSkill);

    expect(resolveSkillReference("claude/foo", cwd, homeDir)).toMatchObject({
      kind: "resolved",
      sourceAgentId: "claude-code",
      sourcePath: claudeUserSkill,
      scope: "user"
    });
  });

  it("resolves prefixed refs from project before user", () => {
    mkdir(claudeProjectSkill);
    mkdir(claudeUserSkill);

    expect(resolveSkillReference("claude/foo", cwd, homeDir)).toMatchObject({
      kind: "resolved",
      sourcePath: claudeProjectSkill,
      scope: "project"
    });
  });

  it("returns unknown-agent for unknown prefixed agent tokens without bare fallback", () => {
    mkdir(nativeProjectSkill);

    expect(resolveSkillReference("nonsense/foo", cwd, homeDir)).toEqual({
      kind: "unknown-agent",
      ref: "nonsense/foo",
      agentInput: "nonsense"
    });
  });

  it.each(["", "foo/", "/foo", "a/b/c", " /foo"])("returns malformed for invalid ref %j", (ref) => {
    expect(resolveSkillReference(ref, cwd, homeDir)).toEqual({
      kind: "malformed",
      ref
    });
  });

  it.each([".", "..", "foo\nsecret.env"])("returns malformed for unsafe bare ref %j", (ref) => {
    expect(resolveSkillReference(ref, cwd, homeDir)).toEqual({ kind: "malformed", ref });
  });

  it.each(["claude/.", "claude/.."])("returns malformed for unsafe prefixed ref %j", (ref) => {
    expect(resolveSkillReference(ref, cwd, homeDir)).toEqual({ kind: "malformed", ref });
  });

  it("returns the post-prefix basename as name for bare and prefixed refs", () => {
    mkdir(nativeProjectSkill);
    mkdir(claudeProjectSkill);

    expect(resolveSkillReference("foo", cwd, homeDir)).toMatchObject({
      kind: "resolved",
      name: "foo"
    });
    expect(resolveSkillReference("claude/foo", cwd, homeDir)).toMatchObject({
      kind: "resolved",
      name: "foo"
    });
  });

  it("returns the canonical sourceAgentId instead of the raw alias", () => {
    mkdir(claudeProjectSkill);

    expect(resolveSkillReference("claude/foo", cwd, homeDir)).toMatchObject({
      kind: "resolved",
      sourceAgentId: "claude-code"
    });
  });

  it("returns not-found for prefixed refs with searched paths in lookup order", () => {
    expect(resolveSkillReference("claude/foo", cwd, homeDir)).toEqual({
      kind: "not-found",
      ref: "claude/foo",
      searchedPaths: [claudeProjectSkill, claudeUserSkill]
    });
  });

  it("does not resolve prefixed refs to files", () => {
    vol.mkdirSync(path.dirname(claudeProjectSkill), { recursive: true });
    vol.writeFileSync(claudeProjectSkill, "not a directory");

    expect(resolveSkillReference("claude/foo", cwd, homeDir)).toEqual({
      kind: "not-found",
      ref: "claude/foo",
      searchedPaths: [claudeProjectSkill, claudeUserSkill]
    });
  });

  it("treats prefixed skill names as case-sensitive", () => {
    mkdir(claudeProjectSkill);

    expect(resolveSkillReference("claude/Foo", cwd, homeDir)).toEqual({
      kind: "not-found",
      ref: "claude/Foo",
      searchedPaths: [
        path.resolve(cwd, ".claude/skills/Foo"),
        path.resolve(homeDir, ".claude/skills/Foo")
      ]
    });
  });
});
