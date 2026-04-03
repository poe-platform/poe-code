import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const spawnState = vi.hoisted(() => ({
  spawn: vi.fn(),
  runCommand: vi.fn()
}));

vi.mock("@poe-code/agent-spawn", () => ({
  spawn: spawnState.spawn,
  runCommand: spawnState.runCommand
}));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { ghGroup } = await import("./commands.js");

const promptDir = fileURLToPath(new URL("./prompts", import.meta.url));
const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const workflowDir = path.join(repoRoot, ".github", "workflows");

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

  it("installs a thin caller workflow and copies the built-in prompt", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    vol.fromJSON({
      [path.join(workflowDir, "gh-github-issue-opened.yml")]: "name: GitHub Issue Opened\n"
    });

    const installCommand = getCommand(["install"]);

    await installCommand.handler(
      createContext({
        name: "github-issue-opened"
      })
    );

    expect(readRepoFile("/repo/.poe-code/github-workflows/github-issue-opened.md")).toBe("# Prompt");
    expect(readRepoFile("/repo/.github/workflows/gh-github-issue-opened.yml")).toContain(
      "uses: poe-code/poe-setup-scripts/.github/workflows/gh-github-issue-opened.yml@main"
    );
  });

  it("does not generate a broken workflow_dispatch trigger for pull-request-opened installs", async () => {
    writeBuiltInPrompt("github-pull-request-opened", "# Prompt");
    vol.fromJSON({
      [path.join(workflowDir, "gh-github-pull-request-opened.yml")]: "name: GitHub Pull Request Opened\n"
    });

    const installCommand = getCommand(["install"]);

    await installCommand.handler(
      createContext({
        name: "github-pull-request-opened"
      })
    );

    const workflow = readRepoFile("/repo/.github/workflows/gh-github-pull-request-opened.yml");
    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toContain("workflow_dispatch:");
  });

  it("installs an ejected workflow copy when --eject is set", async () => {
    writeBuiltInPrompt("github-issue-comment-created", "# Prompt");
    vol.fromJSON({
      [path.join(workflowDir, "gh-github-issue-comment-created.yml")]: "name: GitHub Issue Comment Created\n"
    });

    const installCommand = getCommand(["install"]);

    await installCommand.handler(
      createContext({
        name: "github-issue-comment-created",
        eject: true
      })
    );

    const workflow = readRepoFile("/repo/.github/workflows/gh-github-issue-comment-created.yml");
    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain(
      "npx poe-code github-workflows exec check-user-allow github-issue-comment-created"
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
      "/repo/.github/workflows/gh-github-issue-opened.yml": "workflow",
      "/repo/.poe-code/github-workflows/github-issue-opened.md": "prompt"
    });

    const uninstallCommand = getCommand(["uninstall"]);

    await uninstallCommand.handler(
      createContext({
        name: "github-issue-opened"
      })
    );

    expect(vol.existsSync("/repo/.github/workflows/gh-github-issue-opened.yml")).toBe(false);
    expect(readRepoFile("/repo/.poe-code/github-workflows/github-issue-opened.md")).toBe("prompt");
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
      workflowPath: "/repo/.github/workflows/gh-github-issue-opened.yml"
    });
  });

  it("wires exec commands that enforce allow and prefix frontmatter from the local prompt copy", async () => {
    vol.fromJSON({
      "/repo/.poe-code/github-workflows/github-issue-comment-created.md": [
        "---",
        "allow:",
        "  - OWNER",
        "prefix: poe-code",
        "---",
        "Prompt"
      ].join("\n")
    });

    const checkUserAllowCommand = getCommand(["exec", "check-user-allow"]);
    const requireCommentPrefixCommand = getCommand(["exec", "require-comment-prefix"]);

    await expect(
      checkUserAllowCommand.handler(
        createContext(
          { name: "github-issue-comment-created" },
          { COMMENT_AUTHOR_ASSOCIATION: "MEMBER" }
        )
      )
    ).rejects.toThrow('Automation "github-issue-comment-created" does not allow COMMENT_AUTHOR_ASSOCIATION "MEMBER". Allowed values: OWNER.');

    await expect(
      requireCommentPrefixCommand.handler(
        createContext(
          { name: "github-issue-comment-created" },
          { COMMENT_BODY: "/poe please review" }
        )
      )
    ).rejects.toThrow(
      'Automation "github-issue-comment-created" requires COMMENT_BODY to start with "poe-code".'
    );
  });
});
