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

function writeMarkdown(directory: string, fileName: string, content: string): void {
  const entries = fsState.directories.get(directory) ?? [];
  if (!entries.includes(fileName)) {
    fsState.directories.set(directory, [...entries, fileName].sort((left, right) => left.localeCompare(right)));
  }
  fsState.files.set(`${directory}/${fileName}`, content);
}

describe("discoverAutomations", () => {
  beforeEach(() => {
    fsState.directories.clear();
    fsState.files.clear();
    fsState.readdirErrors.clear();
    fsState.readFileErrors.clear();
  });

  it("prefers the .github/workflows prompt as the document while inheriting shared config from .poe-code and built-ins", async () => {
    writeMarkdown(
      "/built-in",
      "triage.md",
      ["---", "source: gh api repos/{owner}/{repo}/issues", "---", "# Built-in triage", "", "Built-in body"].join("\n")
    );
    writeMarkdown(
      "/poe-code",
      "triage.md",
      ["---", "extends: true", "agent: claude-code", "allow:", "  - OWNER", "---"].join("\n")
    );
    writeMarkdown(
      "/github-workflows",
      "triage.md",
      ["---", "extends: true", "prefix: /poe", "---", "# Repo triage", "", "Repo body"].join("\n")
    );

    await expect(discoverAutomations("/built-in", "/github-workflows", "/poe-code")).resolves.toEqual([
      {
        name: "triage",
        prompt: "# Repo triage\n\nRepo body",
        source: "gh api repos/{owner}/{repo}/issues",
        agent: "claude-code",
        allow: ["OWNER"],
        prefix: "/poe"
      }
    ]);
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
    writeMarkdown("/project", "triage.md", ["---", "extends: true", "---"].join("\n"));
    writeMarkdown(
      "/built-in",
      "triage.md",
      ["---", "agent: claude-code", "allow:", "  - OWNER", "prefix: /poe", "---", "# Built-in triage", "", "Body"].join("\n")
    );

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Built-in triage\n\nBody",
      agent: "claude-code",
      allow: ["OWNER"],
      prefix: "/poe"
    });
  });

  it("lets a project prompt override agent while inheriting everything else", async () => {
    writeMarkdown("/project", "triage.md", ["---", "extends: true", "agent: claude-code", "---"].join("\n"));
    writeMarkdown(
      "/built-in",
      "triage.md",
      ["---", "agent: codex", "source: gh api repos/{owner}/{repo}/issues", "allow:", "  - OWNER", "prefix: /poe", "---", "# Built-in triage"].join("\n")
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

  it("provides the default agent when neither the document nor its base defines one", async () => {
    writeMarkdown("/project", "triage.md", ["---", "extends: true", "---"].join("\n"));
    writeMarkdown("/built-in", "triage.md", "# Built-in triage");

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Built-in triage",
      agent: "codex"
    });
  });

  it("keeps prompts backward compatible when they do not opt into extends", async () => {
    writeMarkdown("/project", "triage.md", "# Project triage");
    writeMarkdown("/built-in", "triage.md", ["---", "allow:", "  - OWNER", "---", "# Built-in triage"].join("\n"));

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Project triage",
      agent: "codex"
    });
  });
});
