import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const spawnState = vi.hoisted(() => ({
  spawn: vi.fn(),
  runCommand: vi.fn()
}));

const designSystemState = vi.hoisted(() => ({
  select: vi.fn()
}));

vi.mock("@poe-code/agent-spawn", () => ({
  spawn: spawnState.spawn,
  runCommand: spawnState.runCommand
}));

vi.mock("@poe-code/design-system", () => ({
  select: designSystemState.select,
  isCancel: () => false,
  cancel: vi.fn()
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { ghGroup } = await import("./commands.js");

const promptDir = fileURLToPath(new URL("./prompts", import.meta.url));
const workflowTemplateDir = fileURLToPath(new URL("./workflow-templates", import.meta.url));

function seedWorkflowTemplate(name: string, variant: "caller" | "ejected"): void {
  const filePath = path.join(workflowTemplateDir, `${name}.${variant}.yml`);
  vol.fromJSON({ [filePath]: readFileSync(filePath, "utf8") });
}

function createEnv(values: Record<string, string | undefined>) {
  return {
    get: (key: string) => values[key]
  };
}

function getCommand(pathSegments: string[]) {
  let node: any = ghGroup;

  for (const segment of pathSegments) {
    const next = node.children.find((child: any) => child.name === segment);
    if (!next) {
      throw new Error(`Missing command node: ${pathSegments.join(" ")}`);
    }
    node = next;
  }

  return node;
}

function createContext<TParams extends Record<string, unknown>>(
  params: TParams,
  envValues: Record<string, string | undefined> = {},
  secrets: Record<string, string | undefined> = {}
) {
  return {
    params,
    secrets,
    fetch: globalThis.fetch,
    fs: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn()
    },
    env: createEnv(envValues),
    progress: vi.fn()
  };
}

function writeBuiltInPrompt(name: string, contents: string): void {
  vol.fromJSON({
    [path.join(promptDir, `${name}.md`)]: contents
  });
}

function readRepoFile(filePath: string): string {
  return vol.readFileSync(filePath, "utf8") as string;
}

describe("ghGroup", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue("/repo");
    spawnState.spawn.mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0
    });
    spawnState.runCommand.mockResolvedValue({
      stdout: "[]",
      stderr: "",
      exitCode: 0
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses run as the default command and keeps the gh alias", () => {
    expect(ghGroup.aliases).toContain("gh");
    expect(ghGroup.default?.name).toBe("run");
  });

  it("renders environment-derived prompt variables for simple automations", async () => {
    writeBuiltInPrompt(
      "github-issue-comment-created",
      "Read {{url}} from {{comment.author}} in {{repo}}: {{comment.body}}"
    );

    const runCommand = getCommand(["run"]);

    await runCommand.handler(
      createContext(
        {
          name: "github-issue-comment-created",
          agent: "codex",
          model: "openai/gpt-5.4",
          cwd: "/repo"
        },
        {
          GITHUB_REPOSITORY: "acme/app",
          ISSUE_NUMBER: "42",
          COMMENT_AUTHOR: "alice",
          COMMENT_BODY: "please fix this"
        },
        {
          poeApiKey: "poe-key",
          githubToken: "gh-token"
        }
      )
    );

    expect(spawnState.spawn).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        cwd: "/repo",
        model: "openai/gpt-5.4",
        prompt: "Read https://github.com/acme/app/issues/42 from alice in acme/app: please fix this"
      })
    );
  });

  it("runs source commands, renders each item, and resolves MCP env references before spawning", async () => {
    writeBuiltInPrompt(
      "fix-vulnerabilities",
      [
        "---",
        "source: gh api repos/{owner}/{repo}/dependabot/alerts --jq '[.[]]'",
        "agent: claude-code",
        "mcp:",
        "  github:",
        "    command: npx",
        "    args:",
        "      - -y",
        "      - github-server",
        "    env:",
        "      GITHUB_PERSONAL_ACCESS_TOKEN: ${{ GITHUB_TOKEN }}",
        "---",
        "Fix {{dependency.package.name}}"
      ].join("\n")
    );
    spawnState.runCommand.mockResolvedValue({
      stdout: JSON.stringify([
        { dependency: { package: { name: "lodash" } } },
        { dependency: { package: { name: "vite" } } }
      ]),
      stderr: "",
      exitCode: 0
    });

    const runCommand = getCommand(["run"]);

    await runCommand.handler(
      createContext(
        {
          name: "fix-vulnerabilities",
          agent: "codex",
          model: "anthropic/claude-opus-4.6",
          mode: "read",
          cwd: "/repo"
        },
        {
          GITHUB_REPOSITORY: "acme/app",
          GITHUB_TOKEN: "gh-token"
        },
        {
          poeApiKey: "poe-key",
          githubToken: "gh-token"
        }
      )
    );

    expect(spawnState.runCommand).toHaveBeenCalledWith(
      "sh",
      ["-c", "gh api repos/acme/app/dependabot/alerts --jq '[.[]]'"],
      expect.objectContaining({
        cwd: "/repo",
        env: expect.objectContaining({
          GITHUB_REPOSITORY: "acme/app",
          GITHUB_TOKEN: "gh-token"
        })
      })
    );
    expect(spawnState.spawn).toHaveBeenCalledTimes(2);
    expect(spawnState.spawn).toHaveBeenNthCalledWith(
      1,
      "claude-code",
      expect.objectContaining({
        cwd: "/repo",
        mode: "read",
        model: "anthropic/claude-opus-4.6",
        prompt: "Fix lodash",
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "github-server"],
            env: {
              GITHUB_PERSONAL_ACCESS_TOKEN: "gh-token"
            }
          }
        }
      })
    );
    expect(spawnState.spawn).toHaveBeenNthCalledWith(
      2,
      "claude-code",
      expect.objectContaining({
        prompt: "Fix vite"
      })
    );
  });

  it("fails when a source command returns invalid JSON", async () => {
    writeBuiltInPrompt(
      "fix-vulnerabilities",
      ["---", "source: printf 'not json'", "---", "Fix {{item}}"].join("\n")
    );
    spawnState.runCommand.mockResolvedValue({
      stdout: "not json",
      stderr: "",
      exitCode: 0
    });

    const runCommand = getCommand(["run"]);

    await expect(
      runCommand.handler(
        createContext(
          {
            name: "fix-vulnerabilities",
            cwd: "/repo"
          },
          {
            GITHUB_REPOSITORY: "acme/app"
          },
          {
            poeApiKey: "poe-key"
          }
        )
      )
    ).rejects.toThrow('Automation "fix-vulnerabilities" source command did not return valid JSON.');
  });

  it("fails when a source command returns a non-array JSON payload", async () => {
    writeBuiltInPrompt(
      "fix-vulnerabilities",
      ["---", "source: printf '{\"ok\":true}'", "---", "Fix {{item}}"].join("\n")
    );
    spawnState.runCommand.mockResolvedValue({
      stdout: JSON.stringify({ ok: true }),
      stderr: "",
      exitCode: 0
    });

    const runCommand = getCommand(["run"]);

    await expect(
      runCommand.handler(
        createContext(
          {
            name: "fix-vulnerabilities",
            cwd: "/repo"
          },
          {
            GITHUB_REPOSITORY: "acme/app"
          },
          {
            poeApiKey: "poe-key"
          }
        )
      )
    ).rejects.toThrow('Automation "fix-vulnerabilities" source command must return a JSON array.');
  });

  it("installs and configures the resolved workflow agent", async () => {
    writeBuiltInPrompt(
      "fix-vulnerabilities",
      ["---", "agent: claude-code", "---", "Fix dependencies"].join("\n")
    );

    const setupAgentCommand = getCommand(["prepare"]);

    await setupAgentCommand.handler(
      createContext({
        name: "fix-vulnerabilities"
      })
    );

    expect(spawnState.runCommand).toHaveBeenNthCalledWith(
      1,
      "poe-code",
      ["install", "claude-code", "--yes"],
      expect.objectContaining({ cwd: "/repo" })
    );
    expect(spawnState.runCommand).toHaveBeenNthCalledWith(
      2,
      "poe-code",
      ["configure", "claude-code", "--yes"],
      expect.objectContaining({ cwd: "/repo" })
    );
  });

  it("defaults prepare to codex when the automation does not declare an agent", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");

    const setupAgentCommand = getCommand(["prepare"]);

    await setupAgentCommand.handler(
      createContext({
        name: "github-issue-opened"
      })
    );

    expect(spawnState.runCommand).toHaveBeenNthCalledWith(
      1,
      "poe-code",
      ["install", "codex", "--yes"],
      expect.objectContaining({ cwd: "/repo" })
    );
    expect(spawnState.runCommand).toHaveBeenNthCalledWith(
      2,
      "poe-code",
      ["configure", "codex", "--yes"],
      expect.objectContaining({ cwd: "/repo" })
    );
  });

  it("surfaces install failures from prepare with command output", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    spawnState.runCommand.mockResolvedValueOnce({
      stdout: "partial output\n",
      stderr: "missing binary\n",
      exitCode: 127
    });

    const setupAgentCommand = getCommand(["prepare"]);

    await expect(
      setupAgentCommand.handler(
        createContext({
          name: "github-issue-opened"
        })
      )
    ).rejects.toThrow(
      [
        "Command failed with exit code 127: poe-code install codex --yes",
        "stderr:",
        "missing binary",
        "stdout:",
        "partial output"
      ].join("\n")
    );
  });

  it("prompts for automation name when run is called without a name in a TTY", async () => {
    writeBuiltInPrompt("github-issue-opened", "Fix {{url}}");
    designSystemState.select.mockResolvedValue("github-issue-opened");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });

    const runCommand = getCommand(["run"]);

    await runCommand.handler(
      createContext(
        { cwd: "/repo" },
        { GITHUB_REPOSITORY: "acme/app", ISSUE_NUMBER: "7" },
        { poeApiKey: "key" }
      )
    );

    Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });

    expect(designSystemState.select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Pick a workflow to run",
        options: expect.arrayContaining([{ label: "GitHub: Issue Opened", value: "github-issue-opened" }])
      })
    );
    expect(spawnState.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ prompt: "Fix https://github.com/acme/app/issues/7" })
    );
  });

  it("throws when run is called without a name outside a TTY", async () => {
    const runCommand = getCommand(["run"]);

    await expect(
      runCommand.handler(createContext({ cwd: "/repo" }, {}, { poeApiKey: "key" }))
    ).rejects.toThrow("Automation name is required.");
  });

  it("lists discovered automations and renders them as a table", async () => {
    writeBuiltInPrompt("beta", ["---", "agent: codex", "---", "Prompt"].join("\n"));
    vol.fromJSON({
      "/repo/.poe-code/github-workflows/alpha.md": "# Local"
    });

    const listCommand = getCommand(["list"]);
    const result = await listCommand.handler(
      createContext({}, {}, {})
    );
    const renderTable = vi.fn(() => "automation table");
    const logger = {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      resolved: vi.fn(),
      errorResolved: vi.fn(),
      message: vi.fn()
    };

    listCommand.render.rich(result, {
      logger,
      renderTable,
      note: vi.fn(),
      getTheme: () => ({
        header: (value: string) => value,
        muted: (value: string) => value
      })
    });

    expect(renderTable).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: [
          expect.objectContaining({ name: "name", title: "Name" }),
          expect.objectContaining({ name: "agent", title: "Agent" }),
          expect.objectContaining({ name: "source", title: "Source" })
        ],
        rows: [
          { name: "alpha", agent: "", source: "direct" },
          { name: "beta", agent: "codex", source: "direct" }
        ]
      })
    );
    expect(logger.message).toHaveBeenCalledWith("automation table");
  });

  it("installs a standalone workflow and prompt copy that use the published CLI", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "ejected");

    const installCommand = getCommand(["install"]);

    const result = await installCommand.handler(
      createContext({
        name: "github-issue-opened"
      })
    );

    expect(vol.existsSync("/repo/.poe-code/github-workflows/poe-code-github-issue-opened.md")).toBe(true);
    expect(readRepoFile("/repo/.github/workflows/poe-code-github-issue-opened.yml")).toContain(
      "npm install -g poe-code@latest"
    );
    expect(readRepoFile("/repo/.github/workflows/poe-code-github-issue-opened.yml")).toContain(
      "poe-code github-workflows prepare poe-code-github-issue-opened"
    );
    expect(readRepoFile("/repo/.github/workflows/poe-code-github-issue-opened.yml")).not.toContain(
      "uses: poe-platform/poe-code/.github/workflows/"
    );
    expect(result).toMatchObject({
      name: "github-issue-opened",
      promptContent: "# Prompt",
      promptPath: "/repo/.poe-code/github-workflows/poe-code-github-issue-opened.md"
    });
  });

  it("shows the default prompt in a note and reports the copied prompt path", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "ejected");

    const installCommand = getCommand(["install"]);
    const result = await installCommand.handler(createContext({ name: "github-issue-opened" }));

    const logger = {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      resolved: vi.fn(),
      errorResolved: vi.fn(),
      message: vi.fn()
    };
    const note = vi.fn();

    installCommand.render.rich(result, {
      logger,
      note,
      renderTable: vi.fn(),
      getTheme: vi.fn()
    });

    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining("poe-code-github-issue-opened.yml"));
    expect(logger.message).toHaveBeenCalledWith(
      "Prompt copied to /repo/.poe-code/github-workflows/poe-code-github-issue-opened.md"
    );
    expect(note).toHaveBeenCalledWith("# Prompt", "Default prompt");
  });

  it("does not generate a broken workflow_dispatch trigger for pull-request-opened installs", async () => {
    writeBuiltInPrompt("github-pull-request-opened", "# Prompt");
    seedWorkflowTemplate("github-pull-request-opened", "ejected");

    const installCommand = getCommand(["install"]);

    await installCommand.handler(
      createContext({
        name: "github-pull-request-opened"
      })
    );

    const workflow = readRepoFile("/repo/.github/workflows/poe-code-github-pull-request-opened.yml");
    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toContain("workflow_dispatch:");
  });

  it("installs the issue comment workflow with standalone guard and prepare steps", async () => {
    writeBuiltInPrompt("github-issue-comment-created", "# Prompt");
    seedWorkflowTemplate("github-issue-comment-created", "ejected");

    const installCommand = getCommand(["install"]);

    await installCommand.handler(
      createContext({
        name: "github-issue-comment-created"
      })
    );

    const workflow = readRepoFile("/repo/.github/workflows/poe-code-github-issue-comment-created.yml");
    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain(
      "poe-code github-workflows require-user-allow poe-code-github-issue-comment-created"
    );
    expect(workflow).toContain(
      "poe-code github-workflows prepare poe-code-github-issue-comment-created"
    );
    expect(workflow).not.toContain("workflow_call:");
  });

  it("fails to install automations that do not have install templates", async () => {
    const installCommand = getCommand(["install"]);

    await expect(
      installCommand.handler(
        createContext({
          name: "alpha"
        })
      )
    ).rejects.toThrow('Automation "alpha" cannot be installed.');
  });

  it("uninstalls the workflow file and leaves the prompt copy intact", async () => {
    vol.fromJSON({
      "/repo/.github/workflows/poe-code-github-issue-opened.yml": "workflow",
      "/repo/.poe-code/github-workflows/poe-code-github-issue-opened.md": "prompt"
    });

    const uninstallCommand = getCommand(["uninstall"]);

    await uninstallCommand.handler(
      createContext({
        name: "github-issue-opened"
      })
    );

    expect(vol.existsSync("/repo/.github/workflows/poe-code-github-issue-opened.yml")).toBe(false);
    expect(readRepoFile("/repo/.poe-code/github-workflows/poe-code-github-issue-opened.md")).toBe("prompt");
  });

  it("treats uninstalling a missing workflow as a no-op", async () => {
    const uninstallCommand = getCommand(["uninstall"]);

    await expect(
      uninstallCommand.handler(
        createContext({
          name: "github-issue-opened"
        })
      )
    ).resolves.toEqual({
      workflowPath: "/repo/.github/workflows/poe-code-github-issue-opened.yml"
    });
  });

  it("wires public require commands that enforce allow and prefix frontmatter from the local prompt copy", async () => {
    vol.fromJSON({
      "/repo/.poe-code/github-workflows/poe-code-github-issue-comment-created.md": [
        "---",
        "allow:",
        "  - OWNER",
        "prefix: poe-code",
        "---",
        "Prompt"
      ].join("\n")
    });

    const checkUserAllowCommand = getCommand(["require-user-allow"]);
    const requireCommentPrefixCommand = getCommand(["require-comment-prefix"]);

    await expect(
      checkUserAllowCommand.handler(
        createContext(
          { name: "poe-code-github-issue-comment-created" },
          { COMMENT_AUTHOR_ASSOCIATION: "MEMBER" }
        )
      )
    ).rejects.toThrow('Automation "poe-code-github-issue-comment-created" does not allow COMMENT_AUTHOR_ASSOCIATION "MEMBER". Allowed values: OWNER.');

    await expect(
      requireCommentPrefixCommand.handler(
        createContext(
          { name: "poe-code-github-issue-comment-created" },
          { COMMENT_BODY: "/poe please review" }
        )
      )
    ).rejects.toThrow(
      'Automation "poe-code-github-issue-comment-created" requires COMMENT_BODY to start with "poe-code".'
    );
  });
});
