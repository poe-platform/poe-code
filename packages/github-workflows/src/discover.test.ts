import { beforeEach, describe, expect, it, vi } from "vitest";

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
        prompt: "# Built-in fix"
      },
      {
        name: "local-only",
        prompt: "# Local only"
      },
      {
        name: "triage",
        prompt: "# Project triage",
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
        prompt: "# Legacy local only"
      },
      {
        name: "triage",
        prompt: "# Ejected triage"
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

  it("loads the first matching automation name from the provided directories", async () => {
    fsState.directories.set("/project", ["triage.md"]);
    fsState.directories.set("/built-in", ["triage.md"]);
    fsState.files.set("/project/triage.md", "# Project triage");
    fsState.files.set("/built-in/triage.md", "# Built-in triage");

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Project triage"
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
      prompt: "# Built-in triage"
    });
  });
});
