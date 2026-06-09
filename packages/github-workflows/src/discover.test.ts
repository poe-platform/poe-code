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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T>
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value
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

describe("discoverAutomations", () => {
  beforeEach(() => {
    fsState.directories.clear();
    fsState.files.clear();
    fsState.readdirErrors.clear();
    fsState.readFileErrors.clear();
  });

  it("discovers a prefixed project prompt and inherits built-in config via extends", async () => {
    writeMarkdown(
      "/built-in",
      "triage.md",
      ["---", "source: gh api repos/{owner}/{repo}/issues", "---", "# Built-in triage", "", "Built-in body"].join("\n")
    );
    writeMarkdown(
      "/github-workflows",
      "poe-code-triage.md",
      ["---", "extends: true", "agent: claude-code", "allow:", "  - OWNER", "---"].join("\n")
    );

    await expect(discoverAutomations("/built-in", "/github-workflows")).resolves.toEqual([
      {
        name: "triage",
        prompt: "# Built-in triage\n\nBuilt-in body",
        source: "gh api repos/{owner}/{repo}/issues",
        agent: "claude-code",
        allow: ["OWNER"]
      }
    ]);
  });

  it("does not ignore directory read failures with inherited missing-path codes", async () => {
    writeMarkdown("/built-in", "triage.md", "# Built-in triage");
    fsState.readdirErrors.set(
      "/project",
      new Error("project directory read denied") as NodeJS.ErrnoException
    );

    await withObjectPrototypeProperties({ code: "ENOTDIR" }, async () => {
      await expect(discoverAutomations("/built-in", "/project")).rejects.toThrow(
        "project directory read denied"
      );
    });
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
    writeMarkdown("/project", "poe-code-triage.md", ["---", "extends: true", "---"].join("\n"));
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
    writeMarkdown("/project", "poe-code-triage.md", ["---", "extends: true", "agent: claude-code", "---"].join("\n"));
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
    writeMarkdown("/project", "poe-code-triage.md", ["---", "extends: true", "---"].join("\n"));
    writeMarkdown("/built-in", "triage.md", "# Built-in triage");

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Built-in triage",
      agent: "codex"
    });
  });

  it("ignores inherited automation fields", async () => {
    writeMarkdown("/built-in", "triage.md", ["---", "{}", "---"].join("\n"));

    await withObjectPrototypeProperties(
      {
        prompt: "Polluted prompt",
        agent: "polluted-agent",
        allow: ["OWNER"],
        prefix: "/poe"
      },
      async () => {
        await expect(loadAutomation("triage", ["/built-in"])).resolves.toEqual({
          name: "triage",
          prompt: "",
          agent: "codex"
        });
      }
    );
  });

  it("does not accept inherited mcp server fields", async () => {
    writeMarkdown(
      "/built-in",
      "triage.md",
      ["---", "mcp:", "  server: {}", "---", "Prompt"].join("\n")
    );

    await withObjectPrototypeProperties({ command: "polluted-command" }, async () => {
      await expect(loadAutomation("triage", ["/built-in"])).rejects.toThrow(
        'Automation "triage.md" has invalid "mcp.server.command" frontmatter. Expected a string.'
      );
    });
  });

  it("falls back to unprefixed filename for backward compatibility", async () => {
    writeMarkdown("/project", "triage.md", "# Project triage");
    writeMarkdown("/built-in", "triage.md", ["---", "allow:", "  - OWNER", "---", "# Built-in triage"].join("\n"));

    await expect(loadAutomation("triage", ["/project", "/built-in"])).resolves.toEqual({
      name: "triage",
      prompt: "# Project triage",
      agent: "codex"
    });
  });
});
