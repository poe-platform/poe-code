import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";
import {
  formatCommandFailure,
  resolveWorkflowAgent
} from "./setup-agent.js";
import type { AutomationDefinition } from "./types.js";
import { UserError } from "agent-kit";
import { checkUserAllow } from "./exec/check-user-allow.js";
import { requireCommentPrefix } from "./exec/require-comment-prefix.js";

const fsState = vi.hoisted(() => ({
  directories: new Map<string, string[]>(),
  files: new Map<string, string>(),
  readdirErrors: new Map<string, NodeJS.ErrnoException>(),
  readFileErrors: new Map<string, NodeJS.ErrnoException>()
}));

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(async (path: string) => {
    const error = fsState.readdirErrors.get(path);
    if (error !== undefined) {
      throw error;
    }

    return fsState.directories.get(path) ?? [];
  }),
  readFile: vi.fn(async (path: string) => {
    const error = fsState.readFileErrors.get(path);
    if (error !== undefined) {
      throw error;
    }

    const file = fsState.files.get(path);
    if (file === undefined) {
      const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }

    return file;
  })
}));

const { discoverAutomations, loadAutomation } = await import("./discover.js");

// === discover.test.ts ===

describe("discoverAutomations", () => {
  beforeEach(() => {
    fsState.directories.clear();
    fsState.files.clear();
    fsState.readdirErrors.clear();
    fsState.readFileErrors.clear();
  });

  it("reads built-in markdown files and derives automation names from filenames", async () => {
    fsState.directories.set("/built-in", ["triage.md", "notes.txt"]);
    fsState.files.set(
      "/built-in/triage.md",
      ["---", "agent: claude", "---", "# Triage", "", "Body"].join("\n")
    );

    await expect(discoverAutomations("/built-in")).resolves.toEqual([
      {
        name: "triage",
        prompt: "# Triage\n\nBody",
        agent: "claude"
      }
    ]);
  });

  it("lets a project-local automation override a built-in automation with the same name", async () => {
    fsState.directories.set("/built-in", ["triage.md", "fix.md"]);
    fsState.directories.set("/project", ["triage.md", "local-only.md"]);
    fsState.files.set("/built-in/triage.md", "# Built-in triage");
    fsState.files.set("/built-in/fix.md", "# Built-in fix");
    fsState.files.set(
      "/project/triage.md",
      ["---", "prefix: /poe", "---", "# Project triage"].join("\n")
    );
    fsState.files.set("/project/local-only.md", "# Local only");

    await expect(discoverAutomations("/built-in", "/project")).resolves.toEqual([
      {
        name: "fix",
        prompt: "# Built-in fix",
        agent: "codex"
      },
      {
        name: "local-only",
        prompt: "# Local only",
        agent: "codex"
      },
      {
        name: "triage",
        prompt: "# Project triage",
        agent: "codex",
        prefix: "/poe"
      }
    ]);
  });

  it("merges multiple project directories in order", async () => {
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.directories.set("/github-workflows", ["triage.md"]);
    fsState.directories.set("/poe-code", ["local-only.md"]);
    fsState.files.set("/built-in/triage.md", "# Built-in triage");
    fsState.files.set("/github-workflows/triage.md", "# Ejected triage");
    fsState.files.set("/poe-code/local-only.md", "# Legacy local only");

    await expect(discoverAutomations("/built-in", "/github-workflows", "/poe-code")).resolves.toEqual([
      {
        name: "local-only",
        prompt: "# Legacy local only",
        agent: "codex"
      },
      {
        name: "triage",
        prompt: "# Ejected triage",
        agent: "codex"
      }
    ]);
  });

  it("ignores missing built-in and project directories", async () => {
    const missingBuiltIn = new Error("missing built-in") as NodeJS.ErrnoException;
    missingBuiltIn.code = "ENOENT";
    const missingProject = new Error("missing project") as NodeJS.ErrnoException;
    missingProject.code = "ENOTDIR";
    fsState.readdirErrors.set("/built-in", missingBuiltIn);
    fsState.readdirErrors.set("/project", missingProject);

    await expect(discoverAutomations("/built-in", "/project")).resolves.toEqual([]);
  });

  it("parses the label frontmatter field", async () => {
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set(
      "/built-in/triage.md",
      ["---", 'label: "Scheduled: My Automation"', "---", "# Prompt"].join("\n")
    );

    await expect(discoverAutomations("/built-in")).resolves.toEqual([
      {
        name: "triage",
        prompt: "# Prompt",
        agent: "codex",
        label: "Scheduled: My Automation"
      }
    ]);
  });

  it("parses optional automation frontmatter fields", async () => {
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set(
      "/built-in/triage.md",
      [
        "---",
        "source: pnpm automations triage --json",
        "agent: gpt-5.4",
        "allow:",
        "  - OWNER",
        "  - MEMBER",
        "prefix: /poe",
        "mcp:",
        "  github:",
        "    command: npx",
        "    args:",
        "      - -y",
        "      - github-mcp-server",
        "    env:",
        "      GITHUB_TOKEN: token",
        "---",
        "# Prompt",
        "",
        "Body"
      ].join("\n")
    );

    await expect(discoverAutomations("/built-in")).resolves.toEqual([
      {
        name: "triage",
        prompt: "# Prompt\n\nBody",
        source: "pnpm automations triage --json",
        agent: "gpt-5.4",
        allow: ["OWNER", "MEMBER"],
        prefix: "/poe",
        mcp: {
          github: {
            command: "npx",
            args: ["-y", "github-mcp-server"],
            env: {
              GITHUB_TOKEN: "token"
            }
          }
        }
      }
    ]);
  });

  it("throws a helpful error when frontmatter fields have the wrong type", async () => {
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set(
      "/built-in/triage.md",
      ["---", "allow: OWNER", "---", "# Prompt"].join("\n")
    );

    await expect(discoverAutomations("/built-in")).rejects.toThrow(
      'Automation "triage.md" has invalid "allow" frontmatter. Expected an array of strings.'
    );
  });

  it("throws when allow contains unsupported GitHub author associations", async () => {
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set(
      "/built-in/triage.md",
      ["---", "allow:", "  - OWNER", "  - RANDOM_USER", "---", "# Prompt"].join("\n")
    );

    await expect(discoverAutomations("/built-in")).rejects.toThrow(
      'Automation "triage.md" has invalid "allow" frontmatter. Unsupported value "RANDOM_USER".'
    );
  });

  it("throws when prefix is blank", async () => {
    fsState.directories.set("/built-in", ["blank.md"]);
    fsState.files.set("/built-in/blank.md", ["---", 'prefix: ""', "---", "# Prompt"].join("\n"));

    await expect(discoverAutomations("/built-in")).rejects.toThrow(
      'Automation "blank.md" has invalid "prefix" frontmatter. Expected a non-empty string without surrounding whitespace.'
    );
  });

  it("throws when prefix has surrounding whitespace", async () => {
    fsState.directories.set("/built-in", ["padded.md"]);
    fsState.files.set(
      "/built-in/padded.md",
      ["---", 'prefix: " poe-code "', "---", "# Prompt"].join("\n")
    );

    await expect(discoverAutomations("/built-in")).rejects.toThrow(
      'Automation "padded.md" has invalid "prefix" frontmatter. Expected a non-empty string without surrounding whitespace.'
    );
  });

  it("parses prefix aliases declared as a string array", async () => {
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set(
      "/built-in/triage.md",
      [
        "---",
        "prefix:",
        "  - poe-code",
        "  - poe-code-agent",
        '  - "@poe-code-agent"',
        "---",
        "# Prompt"
      ].join("\n")
    );

    await expect(discoverAutomations("/built-in")).resolves.toEqual([
      {
        name: "triage",
        prompt: "# Prompt",
        agent: "codex",
        prefix: ["poe-code", "poe-code-agent", "@poe-code-agent"]
      }
    ]);
  });

  it("throws when a prefix alias list contains a blank entry", async () => {
    fsState.directories.set("/built-in", ["blank.md"]);
    fsState.files.set(
      "/built-in/blank.md",
      ["---", "prefix:", "  - poe-code", '  - ""', "---", "# Prompt"].join("\n")
    );

    await expect(discoverAutomations("/built-in")).rejects.toThrow(
      'Automation "blank.md" has invalid "prefix" frontmatter. Expected non-empty strings without surrounding whitespace.'
    );
  });

  it("throws when allow is an empty list", async () => {
    fsState.directories.set("/built-in", ["blank.md", "padded.md"]);
    fsState.files.set("/built-in/blank.md", ["---", "allow: []", "---", "# Prompt"].join("\n"));
    fsState.files.set("/built-in/padded.md", "# Ignored");

    await expect(discoverAutomations("/built-in")).rejects.toThrow(
      'Automation "blank.md" has invalid "allow" frontmatter. Expected at least one GitHub author association.'
    );
  });
});

describe("loadAutomation", () => {
  beforeEach(() => {
    fsState.directories.clear();
    fsState.files.clear();
    fsState.readdirErrors.clear();
    fsState.readFileErrors.clear();
  });

  it("inherits the built-in prompt body and frontmatter when a project prompt extends it", async () => {
    fsState.directories.set("/project", ["triage.md"]);
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set(
      "/project/triage.md",
      ["---", "extends: true", "---"].join("\n")
    );
    fsState.files.set(
      "/built-in/triage.md",
      [
        "---",
        "agent: claude-code",
        "allow:",
        "  - OWNER",
        "prefix: /poe",
        "---",
        "# Built-in triage",
        "",
        "Body"
      ].join("\n")
    );

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Built-in triage\n\nBody",
      agent: "claude-code",
      allow: ["OWNER"],
      prefix: "/poe"
    });
  });

  it("lets a project prompt override agent while inheriting the remaining built-in config", async () => {
    fsState.directories.set("/project", ["triage.md"]);
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set(
      "/project/triage.md",
      ["---", "extends: true", "agent: claude-code", "---"].join("\n")
    );
    fsState.files.set(
      "/built-in/triage.md",
      [
        "---",
        "agent: codex",
        "source: gh api repos/{owner}/{repo}/issues",
        "allow:",
        "  - OWNER",
        "prefix: /poe",
        "---",
        "# Built-in triage"
      ].join("\n")
    );

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Built-in triage",
      agent: "claude-code",
      source: "gh api repos/{owner}/{repo}/issues",
      allow: ["OWNER"],
      prefix: "/poe"
    });
  });

  it("provides the default agent when neither the project document nor its base defines one", async () => {
    fsState.directories.set("/project", ["triage.md"]);
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set(
      "/project/triage.md",
      ["---", "extends: true", "---"].join("\n")
    );
    fsState.files.set("/built-in/triage.md", "# Built-in triage");

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Built-in triage",
      agent: "codex"
    });
  });

  it("keeps project prompts backward compatible when they do not opt into extends", async () => {
    fsState.directories.set("/project", ["triage.md"]);
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set("/project/triage.md", "# Project triage");
    fsState.files.set(
      "/built-in/triage.md",
      ["---", "allow:", "  - OWNER", "---", "# Built-in triage"].join("\n")
    );

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Project triage",
      agent: "codex"
    });
  });

  it("loads the first matching automation name from the provided directories", async () => {
    fsState.directories.set("/project", ["triage.md"]);
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set("/project/triage.md", "# Project triage");
    fsState.files.set("/built-in/triage.md", "# Built-in triage");

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Project triage",
      agent: "codex"
    });
  });

  it("returns undefined when no matching automation exists", async () => {
    fsState.directories.set("/built-in", ["fix.md"]);
    fsState.files.set("/built-in/fix.md", "# Fix");

    await expect(loadAutomation("triage", ["/built-in"])).resolves.toBeUndefined();
  });

  it("skips missing directories when looking for the first matching automation", async () => {
    const missingProject = new Error("missing project") as NodeJS.ErrnoException;
    missingProject.code = "ENOENT";
    fsState.readdirErrors.set("/project", missingProject);
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set("/built-in/triage.md", "# Built-in triage");

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Built-in triage",
      agent: "codex"
    });
  });
});

// === frontmatter.test.ts ===

describe("parseFrontmatter", () => {
  it("returns an empty frontmatter object when the markdown has no frontmatter", () => {
    const markdown = "# Prompt\n\nBody";

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {},
      body: "# Prompt\n\nBody"
    });
  });

  it("does not treat a leading fence without a newline as frontmatter", () => {
    const markdown = "--- heading\n\nBody";

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {},
      body: "--- heading\n\nBody"
    });
  });

  it("parses a yaml frontmatter object and returns the remaining prompt body", () => {
    const markdown = [
      "---",
      "name: triage",
      "model: gpt-5.4",
      "mcp:",
      "  github:",
      "    command: npx",
      "    args:",
      "      - -y",
      "      - github-mcp-server",
      "---",
      "# Prompt",
      "",
      "Investigate the issue."
    ].join("\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {
        name: "triage",
        model: "gpt-5.4",
        mcp: {
          github: {
            command: "npx",
            args: ["-y", "github-mcp-server"]
          }
        }
      },
      body: "# Prompt\n\nInvestigate the issue."
    });
  });

  it("parses frontmatter when the markdown starts with a utf-8 bom", () => {
    const markdown = ["\uFEFF---", "name: triage", "---", "Body"].join("\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {
        name: "triage"
      },
      body: "Body"
    });
  });

  it("returns an empty object for an empty frontmatter block", () => {
    const markdown = ["---", "---", "Body"].join("\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {},
      body: "Body"
    });
  });

  it("supports windows newlines", () => {
    const markdown = [
      "---",
      "name: triage",
      "---",
      "# Prompt",
      "",
      "Body"
    ].join("\r\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {
        name: "triage"
      },
      body: "# Prompt\r\n\r\nBody"
    });
  });

  it("preserves intentional blank lines at the start of the body", () => {
    const markdown = ["---", "name: triage", "---", "", "", "Body"].join("\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {
        name: "triage"
      },
      body: "\n\nBody"
    });
  });

  it("returns an empty body when the document only contains frontmatter", () => {
    const markdown = ["---", "name: triage", "---"].join("\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {
        name: "triage"
      },
      body: ""
    });
  });

  it("throws when the frontmatter block is not closed", () => {
    const markdown = ["---", "name: triage"].join("\n");

    expect(() => parseFrontmatter(markdown)).toThrow(
      "Missing YAML frontmatter end delimiter (---)."
    );
  });

  it("throws when yaml is invalid", () => {
    const markdown = ["---", "name: [", "---", "Body"].join("\n");

    expect(() => parseFrontmatter(markdown)).toThrow(/yaml/i);
  });

  it("throws when the parsed frontmatter is not an object", () => {
    const markdown = ["---", "- triage", "---", "Body"].join("\n");

    expect(() => parseFrontmatter(markdown)).toThrow(
      "YAML frontmatter must parse to an object."
    );
  });
});

// === setup-agent.test.ts ===

describe("setup-agent", () => {
  function createAutomation(partial: Partial<AutomationDefinition>): AutomationDefinition {
    return {
      name: "github-issue-opened",
      prompt: "Prompt",
      ...partial
    };
  }

  it("defaults to codex when the automation does not declare an agent", () => {
    expect(resolveWorkflowAgent(createAutomation({ agent: "" }))).toBe("codex");
  });

  it("returns the declared automation agent", () => {
    expect(resolveWorkflowAgent(createAutomation({ agent: "claude-code" }))).toBe("claude-code");
  });

  it("formats failing poe-code commands with stderr and stdout", () => {
    expect(
      formatCommandFailure("poe-code", ["configure", "codex", "--yes", "--verbose"], {
        exitCode: 127,
        stderr: "missing binary\n",
        stdout: "partial output\n"
      })
    ).toBe(
      [
        "Command failed with exit code 127: poe-code configure codex --yes --verbose",
        "stderr:\nmissing binary",
        "stdout:\npartial output"
      ].join("\n")
    );
  });
});

// === exec/exec.test.ts ===

describe("checkUserAllow", () => {
  it("does nothing when the automation does not declare allow frontmatter", () => {
    expect(() => checkUserAllow({ name: "triage" }, undefined)).not.toThrow();
  });

  it("allows matching GitHub author associations", () => {
    expect(() =>
      checkUserAllow({ name: "triage", allow: ["OWNER", "MEMBER"] }, "MEMBER")
    ).not.toThrow();
  });

  it("throws when COMMENT_AUTHOR_ASSOCIATION is missing for a guarded automation", () => {
    expect(() =>
      checkUserAllow({ name: "triage", allow: ["OWNER", "MEMBER"] }, undefined)
    ).toThrowError(
      new UserError('Automation "triage" requires COMMENT_AUTHOR_ASSOCIATION when "allow" frontmatter is set.')
    );
  });

  it("throws when the commenter association is not permitted", () => {
    expect(() =>
      checkUserAllow({ name: "triage", allow: ["OWNER", "MEMBER"] }, "CONTRIBUTOR")
    ).toThrowError(
      new UserError(
        'Automation "triage" does not allow COMMENT_AUTHOR_ASSOCIATION "CONTRIBUTOR". Allowed values: OWNER, MEMBER.'
      )
    );
  });
});

describe("requireCommentPrefix", () => {
  it("does nothing when the automation does not declare a prefix", () => {
    expect(() => requireCommentPrefix({ name: "triage" }, undefined)).not.toThrow();
  });

  it("allows matching comment prefixes", () => {
    expect(() =>
      requireCommentPrefix({ name: "triage", prefix: "poe-code" }, "poe-code review this")
    ).not.toThrow();
  });

  it("allows matching any configured comment prefix alias", () => {
    expect(() =>
      requireCommentPrefix(
        { name: "triage", prefix: ["poe-code", "poe-code-agent", "@poe-code-agent"] },
        "@poe-code-agent review this"
      )
    ).not.toThrow();
  });

  it("throws when COMMENT_BODY is missing for a prefixed automation", () => {
    expect(() =>
      requireCommentPrefix({ name: "triage", prefix: "poe-code" }, undefined)
    ).toThrowError(
      new UserError('Automation "triage" requires COMMENT_BODY when "prefix" frontmatter is set.')
    );
  });

  it("throws when the comment body does not start with the configured prefix", () => {
    expect(() =>
      requireCommentPrefix({ name: "triage", prefix: "poe-code" }, "/poe please help")
    ).toThrowError(
      new UserError('Automation "triage" requires COMMENT_BODY to start with "poe-code".')
    );
  });

  it("lists all accepted prefixes when multiple aliases are configured", () => {
    expect(() =>
      requireCommentPrefix(
        { name: "triage", prefix: ["poe-code", "poe-code-agent", "@poe-code-agent"] },
        "/poe please help"
      )
    ).toThrowError(
      new UserError(
        'Automation "triage" requires COMMENT_BODY to start with one of: "poe-code", "poe-code-agent", "@poe-code-agent".'
      )
    );
  });
});
