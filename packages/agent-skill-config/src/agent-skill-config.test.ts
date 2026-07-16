import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "@poe-code/config-mutations";
import * as agentSkillConfig from "@poe-code/agent-skill-config";
import {
  getAgentConfig,
  resolveAgentSupport,
  resolveSkillDir,
  supportedAgents
} from "./configs.js";
import { configure, installSkill, unconfigure, UnsupportedAgentError } from "./apply.js";
import { loadTemplate, createTemplateLoader } from "./templates.js";

function createMemFs(): { fs: FileSystem; vol: Volume } {
  const vol = new Volume();
  const fsMem = createFsFromVolume(vol).promises as unknown as FileSystem;
  return { fs: fsMem, vol };
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

function normalizeNewlines(value: string): string {
  return value.replaceAll("\r\n", "\n");
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYamlFrontmatter(markdown: string): Record<string, string> {
  const normalized = normalizeNewlines(markdown);
  const lines = normalized.split("\n");

  if (lines.length === 0 || lines[0] !== "---") {
    throw new Error("Missing YAML frontmatter start delimiter (---).");
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    throw new Error("Missing YAML frontmatter end delimiter (---).");
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const result: Record<string, string> = {};
  for (const rawLine of frontmatterLines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      throw new Error(`Invalid frontmatter line: "${rawLine}"`);
    }
    const key = line.slice(0, colonIndex).trim();
    const value = stripQuotes(line.slice(colonIndex + 1).trim());
    if (key.length === 0) {
      throw new Error(`Invalid frontmatter key in line: "${rawLine}"`);
    }
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`Duplicate frontmatter key: "${key}"`);
    }
    result[key] = value;
  }

  return result;
}

function extractBodyAfterFrontmatter(markdown: string): string {
  const normalized = normalizeNewlines(markdown);
  const lines = normalized.split("\n");

  if (lines.length === 0 || lines[0] !== "---") {
    return normalized;
  }

  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      return lines.slice(i + 1).join("\n");
    }
  }

  return "";
}

// --- configs.test.ts ---

describe("supportedAgents", () => {
  it("includes supported agent ids", () => {
    expect(supportedAgents).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "gemini-cli",
      "opencode",
      "goose"
    ]);
  });

  it("does not expose mutable agent config state", () => {
    const config = getAgentConfig("codex")!;
    config.localSkillDir = ".redirected/skills";
    expect(getAgentConfig("codex")?.localSkillDir).toBe(".codex/skills");
  });
});

describe("resolveAgentSupport", () => {
  const claudeConfig = {
    globalSkillDir: "/test/global/claude",
    localSkillDir: "test/local/claude"
  };
  const gooseConfig = { globalSkillDir: "/test/global/goose", localSkillDir: "test/local/goose" };
  const fixtureRegistry = { "claude-code": claudeConfig, goose: gooseConfig };

  it("returns supported for direct agent id", () => {
    const result = resolveAgentSupport("claude-code", fixtureRegistry);
    expect(result.status).toBe("supported");
    expect(result.id).toBe("claude-code");
    expect(result.config).toEqual(claudeConfig);
  });

  it("returns supported for aliases resolved via resolveAgentId", () => {
    const result = resolveAgentSupport("CLAUDE", fixtureRegistry);
    expect(result.status).toBe("supported");
    expect(result.id).toBe("claude-code");
    expect(result.config).toEqual(claudeConfig);
  });

  it("returns supported for goose", () => {
    const result = resolveAgentSupport("goose", fixtureRegistry);
    expect(result.status).toBe("supported");
    expect(result.id).toBe("goose");
    expect(result.config).toEqual(gooseConfig);
  });

  it("returns unknown when no agent matches", () => {
    const result = resolveAgentSupport("unknown", fixtureRegistry);
    expect(result).toEqual({ status: "unknown", input: "unknown" });
  });
});

describe("getAgentConfig", () => {
  it("returns config for supported agent id", () => {
    expect(getAgentConfig("codex")).toEqual({
      globalSkillDir: "~/.codex/skills",
      localSkillDir: ".codex/skills"
    });
  });

  it("returns undefined for unknown input", () => {
    expect(getAgentConfig("unknown")).toBeUndefined();
  });

  it("returns Gemini CLI skill directories", () => {
    expect(getAgentConfig("gemini-cli")).toEqual({
      globalSkillDir: "~/.gemini/skills",
      localSkillDir: ".gemini/skills"
    });
  });
});

describe("resolveSkillDir", () => {
  it("resolves local path relative to cwd", () => {
    const config = getAgentConfig("claude-code");
    expect(config).toBeDefined();

    const cwd = "/repo";
    const result = resolveSkillDir(config!, "local", cwd);
    expect(result).toBe(path.resolve(cwd, ".claude/skills"));
  });

  it("resolves global path relative to the home directory", () => {
    const config = getAgentConfig("opencode");
    expect(config).toBeDefined();

    const result = resolveSkillDir(config!, "global", "/repo");
    expect(result).toBe(path.resolve(path.join(os.homedir(), ".config/opencode/skills")));
  });

  it("resolves goose directories using .agents conventions", () => {
    const config = getAgentConfig("goose");
    expect(config).toBeDefined();

    const cwd = "/repo";
    expect(resolveSkillDir(config!, "local", cwd)).toBe(path.resolve(cwd, ".agents/skills"));
    expect(resolveSkillDir(config!, "global", cwd)).toBe(
      path.resolve(path.join(os.homedir(), ".agents/skills"))
    );
  });
});

// --- index.test.ts ---

describe("@poe-code/agent-skill-config", () => {
  it("exports configure SDK surface", () => {
    expect(agentSkillConfig.supportedAgents.length).toBeGreaterThan(0);
    expect(typeof agentSkillConfig.resolveAgentSupport).toBe("function");
    expect(typeof agentSkillConfig.getAgentConfig).toBe("function");
    expect(typeof agentSkillConfig.resolveSkillDir).toBe("function");
    expect(typeof agentSkillConfig.resolveSkillReference).toBe("function");
    expect(typeof agentSkillConfig.configure).toBe("function");
    expect(typeof agentSkillConfig.unconfigure).toBe("function");
    expect(typeof agentSkillConfig.UnsupportedAgentError).toBe("function");
    expect(typeof agentSkillConfig.appendExcludeBlock).toBe("function");
    expect(typeof agentSkillConfig.removeExcludeBlock).toBe("function");
    expect(typeof agentSkillConfig.bridgeActiveSkills).toBe("function");
    expect(typeof agentSkillConfig.cleanupBridgedSkills).toBe("function");
  });
});

// --- apply.test.ts ---

describe("configure", () => {
  const homeDir = "/home/test";
  const cwd = "/project";
  let memFs: FileSystem;
  let vol: Volume;

  beforeEach(() => {
    ({ fs: memFs, vol } = createMemFs());
    vol.mkdirSync(homeDir, { recursive: true });
    vol.mkdirSync(cwd, { recursive: true });
  });

  it("throws UnsupportedAgentError for unknown agent", async () => {
    await expect(configure("invalid", { fs: memFs, homeDir, cwd })).rejects.toBeInstanceOf(
      UnsupportedAgentError
    );
  });

  it("creates global skill directory by default and writes bundled skills", async () => {
    await configure("claude-code", { fs: memFs, homeDir, cwd });

    await expect(memFs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    const content = await memFs.readFile(`${homeDir}/.claude/skills/poe-generate.md`, {
      encoding: "utf8"
    });
    expect(content).toContain("name: poe-generate");
    expect(content).toContain("# Poe Code Prompting");
  });

  it("creates local skill directory in cwd and writes bundled skills", async () => {
    await configure("claude-code", { fs: memFs, homeDir, cwd, scope: "local" });

    await expect(memFs.stat(`${cwd}/.claude/skills`)).resolves.toBeDefined();
    const content = await memFs.readFile(`${cwd}/.claude/skills/poe-generate.md`, {
      encoding: "utf8"
    });
    expect(content).toContain("name: poe-generate");
    expect(content).toContain("# Poe Code Prompting");
  });

  it("does not overwrite a user-authored bundled filename", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await memFs.writeFile(`${homeDir}/.claude/skills/poe-generate.md`, "user skill", {
      encoding: "utf8"
    });

    await expect(configure("claude-code", { fs: memFs, homeDir, cwd })).rejects.toThrow(
      "already exists"
    );
    await expect(memFs.readFile(`${homeDir}/.claude/skills/poe-generate.md`, "utf8")).resolves.toBe(
      "user skill"
    );
  });

  it("does not treat inherited stat error codes as missing bundled skills", async () => {
    const targetPath = `${homeDir}/.claude/skills/poe-generate.md`;
    let denied = false;
    const fsWithDeniedStat: FileSystem = {
      ...memFs,
      stat: async (filePath) => {
        if (filePath === targetPath && !denied) {
          denied = true;
          throw new Error("stat denied");
        }

        return memFs.stat(filePath);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(
        configure("claude-code", { fs: fsWithDeniedStat, homeDir, cwd })
      ).rejects.toThrow("stat denied");
    });
  });

  it("is idempotent when the bundled skill is already installed", async () => {
    await configure("claude-code", { fs: memFs, homeDir, cwd });
    await expect(configure("claude-code", { fs: memFs, homeDir, cwd })).resolves.toBeUndefined();
  });

  it("creates goose skill directories using the shared .agents convention", async () => {
    await configure("goose", { fs: memFs, homeDir, cwd });
    await configure("goose", { fs: memFs, homeDir, cwd, scope: "local" });

    await expect(memFs.stat(`${homeDir}/.agents/skills`)).resolves.toBeDefined();
    await expect(memFs.stat(`${cwd}/.agents/skills`)).resolves.toBeDefined();

    const globalContent = await memFs.readFile(`${homeDir}/.agents/skills/poe-generate.md`, {
      encoding: "utf8"
    });
    const localContent = await memFs.readFile(`${cwd}/.agents/skills/poe-generate.md`, {
      encoding: "utf8"
    });

    expect(globalContent).toContain("name: poe-generate");
    expect(localContent).toContain("name: poe-generate");
  });
});

describe("unconfigure", () => {
  const homeDir = "/home/test";
  const cwd = "/project";
  let memFs: FileSystem;
  let vol: Volume;

  beforeEach(() => {
    ({ fs: memFs, vol } = createMemFs());
    vol.mkdirSync(homeDir, { recursive: true });
    vol.mkdirSync(cwd, { recursive: true });
  });

  it("throws UnsupportedAgentError for unknown agent", async () => {
    await expect(unconfigure("unknown", { fs: memFs, homeDir, cwd })).rejects.toBeInstanceOf(
      UnsupportedAgentError
    );
  });

  it("removes global bundled skill and the emptied root when force is set", async () => {
    await configure("claude-code", { fs: memFs, homeDir, cwd });

    await unconfigure("claude-code", { fs: memFs, homeDir, cwd, force: true });

    await expect(memFs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });

  it("never removes unmanaged files from the global skills root when force is set", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await memFs.writeFile(`${homeDir}/.claude/skills/a.txt`, "hello", { encoding: "utf8" });

    await unconfigure("claude-code", { fs: memFs, homeDir, cwd, force: true });

    await expect(memFs.readFile(`${homeDir}/.claude/skills/a.txt`, "utf8")).resolves.toBe("hello");
  });

  it("does nothing for non-empty global skill directory without force", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await memFs.writeFile(`${homeDir}/.claude/skills/a.txt`, "hello", { encoding: "utf8" });

    await unconfigure("claude-code", { fs: memFs, homeDir, cwd });

    await expect(memFs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    await expect(memFs.readdir(`${homeDir}/.claude/skills`)).resolves.toContain("a.txt");
  });

  it("removes empty global skill directory without force", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });

    await unconfigure("claude-code", { fs: memFs, homeDir, cwd });

    await expect(memFs.stat(`${homeDir}/.claude/skills`)).rejects.toThrow("ENOENT");
  });

  it("removes its bundled skill during ordinary unconfigure", async () => {
    await configure("claude-code", { fs: memFs, homeDir, cwd });
    await unconfigure("claude-code", { fs: memFs, homeDir, cwd });

    await expect(memFs.stat(`${homeDir}/.claude/skills/poe-generate.md`)).rejects.toThrow("ENOENT");
  });

  it("preserves an unowned skill during ordinary unconfigure", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await memFs.writeFile(`${homeDir}/.claude/skills/poe-generate.md`, "user skill", {
      encoding: "utf8"
    });

    await unconfigure("claude-code", { fs: memFs, homeDir, cwd });

    await expect(memFs.readFile(`${homeDir}/.claude/skills/poe-generate.md`, "utf8")).resolves.toBe(
      "user skill"
    );
  });

  it("removes local bundled skill in cwd when force is set", async () => {
    await configure("claude-code", { fs: memFs, homeDir, cwd, scope: "local" });

    await unconfigure("claude-code", { fs: memFs, homeDir, cwd, scope: "local", force: true });

    await expect(memFs.stat(`${cwd}/.claude/skills`)).rejects.toThrow("ENOENT");
  });

  it("keeps the global skills root and unmanaged skills when force is set", async () => {
    await configure("claude-code", { fs: memFs, homeDir, cwd });
    vol.mkdirSync(`${homeDir}/.claude/skills/poe-code-pipeline-plan`, { recursive: true });
    await memFs.writeFile(
      `${homeDir}/.claude/skills/poe-code-pipeline-plan/SKILL.md`,
      "user authored",
      { encoding: "utf8" }
    );

    await unconfigure("claude-code", { fs: memFs, homeDir, cwd, force: true });

    await expect(
      memFs.readFile(`${homeDir}/.claude/skills/poe-code-pipeline-plan/SKILL.md`, "utf8")
    ).resolves.toBe("user authored");
    await expect(memFs.stat(`${homeDir}/.claude/skills`)).resolves.toBeDefined();
    await expect(memFs.stat(`${homeDir}/.claude/skills/poe-generate.md`)).rejects.toThrow("ENOENT");
  });

  it("keeps the local skills root and unmanaged skills when force is set", async () => {
    vol.mkdirSync(`${cwd}/.claude/skills/terminal-pilot`, { recursive: true });
    await memFs.writeFile(`${cwd}/.claude/skills/terminal-pilot/SKILL.md`, "user authored", {
      encoding: "utf8"
    });

    await unconfigure("claude-code", { fs: memFs, homeDir, cwd, scope: "local", force: true });

    await expect(
      memFs.readFile(`${cwd}/.claude/skills/terminal-pilot/SKILL.md`, "utf8")
    ).resolves.toBe("user authored");
    await expect(memFs.stat(`${cwd}/.claude/skills`)).resolves.toBeDefined();
  });

  it("removes a locally modified bundled skill only when force is set", async () => {
    await configure("claude-code", { fs: memFs, homeDir, cwd });
    await memFs.writeFile(`${homeDir}/.claude/skills/poe-generate.md`, "edited by user", {
      encoding: "utf8"
    });

    await unconfigure("claude-code", { fs: memFs, homeDir, cwd });
    await expect(memFs.readFile(`${homeDir}/.claude/skills/poe-generate.md`, "utf8")).resolves.toBe(
      "edited by user"
    );

    await unconfigure("claude-code", { fs: memFs, homeDir, cwd, force: true });
    await expect(memFs.stat(`${homeDir}/.claude/skills/poe-generate.md`)).rejects.toThrow("ENOENT");
  });

  it("labels local scope mutations with project-relative paths", async () => {
    await configure("claude-code", { fs: memFs, homeDir, cwd, scope: "local" });
    const labels: string[] = [];

    await unconfigure("claude-code", {
      fs: memFs,
      homeDir,
      cwd,
      scope: "local",
      dryRun: true,
      observers: {
        onStart: (details) => {
          labels.push(details.label);
        }
      }
    });

    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((label) => label.includes(".claude/skills"))).toBe(true);
    expect(labels.filter((label) => label.includes("~/"))).toEqual([]);
  });

  it("resolves local scope removals inside the project, never the home directory", async () => {
    vol.mkdirSync(`${homeDir}/.claude/skills`, { recursive: true });
    await memFs.writeFile(`${homeDir}/.claude/skills/poe-generate.md`, "home skill", {
      encoding: "utf8"
    });
    await configure("claude-code", { fs: memFs, homeDir, cwd, scope: "local" });
    const targets: string[] = [];

    await unconfigure("claude-code", {
      fs: memFs,
      homeDir,
      cwd,
      scope: "local",
      force: true,
      observers: {
        onComplete: (details) => {
          if (details.targetPath) {
            targets.push(details.targetPath);
          }
        }
      }
    });

    expect(targets.every((target) => target.startsWith(cwd))).toBe(true);
    await expect(memFs.readFile(`${homeDir}/.claude/skills/poe-generate.md`, "utf8")).resolves.toBe(
      "home skill"
    );
  });
});

describe("installSkill", () => {
  const homeDir = "/home/test";
  const cwd = "/project";
  let memFs: FileSystem;
  let vol: Volume;

  beforeEach(() => {
    ({ fs: memFs, vol } = createMemFs());
    vol.mkdirSync(homeDir, { recursive: true });
    vol.mkdirSync(cwd, { recursive: true });
  });

  it("installs the bundled terminal-pilot template into the agent skill directory", async () => {
    const template = await loadTemplate("terminal-pilot.md");

    const result = await installSkill(
      "claude-code",
      { name: "terminal-pilot", content: template },
      { fs: memFs, cwd, homeDir, scope: "local" }
    );

    expect(result).toEqual({
      skillPath: "/project/.claude/skills/terminal-pilot/SKILL.md",
      displayPath: ".claude/skills/terminal-pilot/SKILL.md"
    });

    const content = await memFs.readFile(`${cwd}/.claude/skills/terminal-pilot/SKILL.md`, {
      encoding: "utf8"
    });
    expect(content).toContain("name: terminal-pilot");
    expect(content).toContain("# Terminal Pilot");
    expect(content).toContain("terminal-pilot create-session");
    expect(content).not.toContain("MCP");
  });

  it("throws UnsupportedAgentError for unknown agent", async () => {
    await expect(
      installSkill(
        "invalid",
        { name: "terminal-pilot", content: "test" },
        { fs: memFs, cwd, homeDir, scope: "local" }
      )
    ).rejects.toBeInstanceOf(UnsupportedAgentError);
  });

  it("installs a goose skill into the shared local .agents directory", async () => {
    const result = await installSkill(
      "goose",
      { name: "terminal-pilot", content: "# Goose skill" },
      { fs: memFs, cwd, homeDir, scope: "local" }
    );

    expect(result).toEqual({
      skillPath: "/project/.agents/skills/terminal-pilot/SKILL.md",
      displayPath: ".agents/skills/terminal-pilot/SKILL.md"
    });

    await expect(
      memFs.readFile(`${cwd}/.agents/skills/terminal-pilot/SKILL.md`, {
        encoding: "utf8"
      })
    ).resolves.toBe("# Goose skill");
  });

  it("rejects skill names that escape the configured skill directory", async () => {
    await expect(
      installSkill(
        "claude-code",
        { name: "../escaped", content: "outside" },
        { fs: memFs, cwd, homeDir, scope: "local" }
      )
    ).rejects.toThrow("skill name");
  });

  it.each(["   ", "foo "])("rejects whitespace-padded skill name %j", async (name) => {
    await expect(
      installSkill(
        "claude-code",
        { name, content: "# invalid\n" },
        { fs: memFs, cwd, homeDir, scope: "local" }
      )
    ).rejects.toThrow("skill name");
  });

  it("does not overwrite an existing user-installed skill", async () => {
    vol.mkdirSync(`${cwd}/.claude/skills/existing`, { recursive: true });
    await memFs.writeFile(`${cwd}/.claude/skills/existing/SKILL.md`, "user", { encoding: "utf8" });

    await expect(
      installSkill(
        "claude-code",
        { name: "existing", content: "generated" },
        { fs: memFs, cwd, homeDir, scope: "local" }
      )
    ).rejects.toThrow("already exists");
    await expect(memFs.readFile(`${cwd}/.claude/skills/existing/SKILL.md`, "utf8")).resolves.toBe(
      "user"
    );
  });
});

// --- templates.test.ts ---

describe("createTemplateLoader", () => {
  it("loads bundled templates by id", async () => {
    const loader = createTemplateLoader();
    const template = await loader("poe-generate.md");

    expect(template).toContain("# Poe Code Prompting");
    expect(template).toContain("poe-code spawn");
    expect(template).not.toContain("poe-code generate");
  });

  it("loads the terminal-pilot bundled template by id", async () => {
    const loader = createTemplateLoader();
    const template = await loader("terminal-pilot.md");

    expect(template).toContain("# Terminal Pilot");
    expect(template).toContain("terminal-pilot create-session");
    expect(template).not.toContain("MCP");
  });

  it("throws when template does not exist", async () => {
    const loader = createTemplateLoader();
    await expect(loader("nonexistent.md")).rejects.toThrow();
  });
});

// --- templates/poe-generate.test.ts ---

describe("bundled skill template: poe-generate.md", () => {
  it("renders valid markdown with YAML frontmatter", async () => {
    const templateUrl = new URL("./templates/poe-generate.md", import.meta.url);
    const template = await fs.readFile(templateUrl, "utf8");

    const frontmatter = parseYamlFrontmatter(template);
    expect(frontmatter).toMatchObject({
      name: "poe-generate",
      description: "Poe Code agent prompting guidance"
    });

    const body = extractBodyAfterFrontmatter(template);
    expect(body.trim().length).toBeGreaterThan(0);
    expect(body).toContain("poe-code agent");
    expect(body).toContain("poe-code spawn");
    expect(body).not.toContain("poe-code generate");
  });

  it("fails validation when frontmatter is malformed", () => {
    expect(() => parseYamlFrontmatter(["---", "name: poe-generate"].join("\n"))).toThrow(
      "Missing YAML frontmatter end delimiter"
    );
  });
});

// --- templates/terminal-pilot.test.ts ---

describe("bundled skill template: terminal-pilot.md", () => {
  it("renders valid markdown with YAML frontmatter and terminal-pilot guidance", async () => {
    const templateUrl = new URL("./templates/terminal-pilot.md", import.meta.url);
    const template = await fs.readFile(templateUrl, "utf8");

    const frontmatter = parseYamlFrontmatter(template);
    expect(frontmatter).toMatchObject({
      name: "terminal-pilot",
      description: "Terminal automation skill using the terminal-pilot CLI"
    });

    const body = extractBodyAfterFrontmatter(template);
    expect(body.trim().length).toBeGreaterThan(0);
    expect(body).toContain("terminal-pilot create-session");
    expect(body).toContain("terminal-pilot fill");
    expect(body).toContain("terminal-pilot type");
    expect(body).toContain("terminal-pilot press-key");
    expect(body).toContain("terminal-pilot read-screen");
    expect(body).toContain("terminal-pilot read-history");
    expect(body).toContain("terminal-pilot wait-for");
    expect(body).toContain("terminal-pilot wait-for-exit");
    expect(body).toContain("terminal-pilot list-sessions");
    expect(body).toContain("terminal-pilot close-session");
    expect(body).toContain("Default terminal size is 120x40");
    expect(body).not.toContain("MCP");
  });
});
