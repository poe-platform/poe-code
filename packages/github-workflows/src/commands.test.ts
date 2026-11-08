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

const fileSystemState = vi.hoisted(() => ({
  failingWritePath: undefined as string | undefined,
  beforeFailingWrite: undefined as
    | ((
        targetPath: string,
        content: string | Uint8Array,
        options?: BufferEncoding | { encoding?: BufferEncoding; flag?: string }
      ) => void | Promise<void>)
    | undefined,
  symlinkRacePath: undefined as string | undefined,
  symlinkRaceTarget: undefined as string | undefined
}));

vi.mock("@poe-code/agent-spawn", () => ({
  spawn: spawnState.spawn,
  runCommand: spawnState.runCommand
}));

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    getTemplatePartialNames: actual.getTemplatePartialNames,
    renderTemplate: actual.renderTemplate,
    resolveTemplatePartials: actual.resolveTemplatePartials,
    select: designSystemState.select,
    isCancel: () => false,
    cancel: vi.fn()
  };
});

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  function hasOwnErrorCode(error: unknown, code: string): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      Object.prototype.hasOwnProperty.call(error, "code") &&
      (error as { code?: unknown }).code === code
    );
  }

  async function replaceWithSymlink(path: string, target: string): Promise<void> {
    try {
      await fs.promises.unlink(path);
    } catch (error) {
      if (!hasOwnErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
    await fs.promises.symlink(target, path);
  }

  function isInjectedFailingWrite(targetPath: string): boolean {
    return (
      targetPath === fileSystemState.failingWritePath ||
      (fileSystemState.failingWritePath !== undefined &&
        targetPath.startsWith(`${fileSystemState.failingWritePath}.`) &&
        targetPath.endsWith(".tmp"))
    );
  }

  return {
    ...fs.promises,
    async writeFile(
      targetPath: string,
      content: string | Uint8Array,
      options?: BufferEncoding | { encoding?: BufferEncoding; flag?: string }
    ) {
      if (
        targetPath === fileSystemState.symlinkRacePath &&
        fileSystemState.symlinkRaceTarget !== undefined
      ) {
        await replaceWithSymlink(targetPath, fileSystemState.symlinkRaceTarget);
      }
      if (isInjectedFailingWrite(targetPath)) {
        await fileSystemState.beforeFailingWrite?.(targetPath, content, options);
        throw new Error("injected workflow write failure");
      }
      await fs.promises.writeFile(targetPath, content, options);
    },
    async rename(oldPath: string, newPath: string) {
      if (
        newPath === fileSystemState.symlinkRacePath &&
        fileSystemState.symlinkRaceTarget !== undefined
      ) {
        await replaceWithSymlink(newPath, fileSystemState.symlinkRaceTarget);
      }
      await fs.promises.rename(oldPath, newPath);
    }
  };
});

const { ghGroup } = await import("./commands.js");
const { workflowSubprocessTimeoutMs } = await import("./subprocess-timeout.js");

const promptDir = fileURLToPath(new URL("./prompts", import.meta.url));
const builtInDir = path.dirname(promptDir);
const workflowTemplateDir = fileURLToPath(new URL("./workflow-templates", import.meta.url));
const builtInVariablesPath = path.join(builtInDir, "variables.yaml");
const installableAutomationNames = [
  "fix-vulnerabilities",
  "github-issue-comment-created",
  "github-issue-opened",
  "github-pull-request-comment-created",
  "github-pull-request-opened",
  "github-pull-request-synchronized",
  "update-dependencies",
  "update-documentation"
] as const;

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

describe("ghGroup", () => {
  beforeEach(() => {
    vol.reset();
    vol.fromJSON({
      [builtInVariablesPath]: readFileSync(builtInVariablesPath, "utf8")
    });
    vi.clearAllMocks();
    fileSystemState.failingWritePath = undefined;
    fileSystemState.beforeFailingWrite = undefined;
    fileSystemState.symlinkRacePath = undefined;
    fileSystemState.symlinkRaceTarget = undefined;
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

  it("previews direct automation runs without spawning agents", async () => {
    writeBuiltInPrompt("github-issue-opened", "Fix {{url}}");

    const result = await getCommand(["run"]).handler(
      createContext(
        { name: "github-issue-opened", cwd: "/repo", dryRun: true },
        { GITHUB_REPOSITORY: "acme/app", ISSUE_NUMBER: "42" },
        { poeApiKey: "poe-key" }
      )
    );

    expect(spawnState.spawn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, automation: "github-issue-opened", agent: "codex" });
  });

  it("fails the automation when the spawned agent exits non-zero", async () => {
    writeBuiltInPrompt("github-issue-opened", "Fix {{url}}");
    spawnState.spawn.mockResolvedValueOnce({
      stdout: "agent stdout",
      stderr: "agent stderr",
      exitCode: 1
    });

    const runCommand = getCommand(["run"]);

    await expect(
      runCommand.handler(
        createContext(
          {
            name: "github-issue-opened",
            cwd: "/repo"
          },
          {
            GITHUB_REPOSITORY: "acme/app",
            ISSUE_NUMBER: "281"
          },
          {
            poeApiKey: "poe-key"
          }
        )
      )
    ).rejects.toThrow(
      [
        'Automation "github-issue-opened" failed: 0/1 spawned agent runs exited successfully.',
        "First failure exited with code 1.",
        "stderr:",
        "agent stderr",
        "stdout:",
        "agent stdout"
      ].join("\n")
    );
  });

  it("merges shared variables into run prompts while keeping env context higher priority", async () => {
    writeBuiltInPrompt(
      "github-issue-opened",
      ["Repo from env: {{repo}}", "Style:", "{{response_style}}"].join("\n")
    );
    vol.fromJSON({
      "/repo/.github/workflows/variables.yaml": [
        "repo: overridden-by-project",
        "response_style: |",
        "  - Use the repository house style.",
        ""
      ].join("\n")
    });

    const runCommand = getCommand(["run"]);

    await runCommand.handler(
      createContext(
        {
          name: "github-issue-opened",
          agent: "codex",
          cwd: "/repo"
        },
        {
          GITHUB_REPOSITORY: "acme/app"
        },
        {
          poeApiKey: "poe-key"
        }
      )
    );

    expect(spawnState.spawn).toHaveBeenCalledWith(
      "codex",
      expect.objectContaining({
        prompt: ["Repo from env: acme/app", "Style:", "- Use the repository house style.", ""].join("\n")
      })
    );
  });

  it("renders pull request comment context with the pull request URL when PR env is present", async () => {
    writeBuiltInPrompt(
      "github-issue-comment-created",
      "Read {{url}} from {{comment.author}} on PR {{pr.number}} by {{pr.author}}: {{comment.body}}"
    );

    const runCommand = getCommand(["run"]);

    await runCommand.handler(
      createContext(
        {
          name: "github-issue-comment-created",
          agent: "codex",
          cwd: "/repo"
        },
        {
          GITHUB_REPOSITORY: "acme/app",
          ISSUE_NUMBER: "42",
          PR_NUMBER: "42",
          PR_TITLE: "Fix auth flow",
          PR_AUTHOR: "alice",
          COMMENT_AUTHOR: "bob",
          COMMENT_BODY: "poe-code-agent please apply this"
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
        prompt:
          "Read https://github.com/acme/app/pull/42 from bob on PR 42 by alice: poe-code-agent please apply this"
      })
    );
  });

  it("renders issue title and body variables for issue-opened automations", async () => {
    writeBuiltInPrompt(
      "github-issue-opened",
      "Answer {{issue.title}} in {{repo}}: {{issue.body}}"
    );

    const runCommand = getCommand(["run"]);

    await runCommand.handler(
      createContext(
        {
          name: "github-issue-opened",
          agent: "codex",
          cwd: "/repo"
        },
        {
          GITHUB_REPOSITORY: "acme/app",
          ISSUE_NUMBER: "42",
          ISSUE_TITLE: "How do I configure this?",
          ISSUE_BODY: "I want the exact path."
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
        prompt: "Answer How do I configure this? in acme/app: I want the exact path."
      })
    );
  });

  it("renders prompt-preview with environment-derived issue context", async () => {
    writeBuiltInPrompt(
      "github-issue-opened",
      [
        "Issue URL: {{url}}",
        "Issue title: {{issue.title}}",
        "{{#issue.body}}Issue body: {{issue.body}}{{/issue.body}}"
      ].join("\n")
    );

    const promptPreviewCommand = getCommand(["prompt-preview"]);

    await expect(
      promptPreviewCommand.handler(
        createContext(
          {
            name: "github-issue-opened"
          },
          {
            GITHUB_REPOSITORY: "acme/app",
            ISSUE_NUMBER: "188",
            ISSUE_TITLE: "Can I configure paths for planning docs on ralph?"
          }
        )
      )
    ).resolves.toEqual({
      name: "github-issue-opened",
      prompt: [
        "Issue URL: https://github.com/acme/app/issues/188",
        "Issue title: Can I configure paths for planning docs on ralph?",
        ""
      ].join("\n")
    });
  });

  it("prefers the poe-code-prefixed prompt file in .github/workflows over the built-in", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Built-in prompt");
    vol.fromJSON({
      "/repo/.github/workflows/poe-code-github-issue-opened.md": "# Project override"
    });

    const promptPreviewCommand = getCommand(["prompt-preview"]);

    await expect(
      promptPreviewCommand.handler(
        createContext({
          name: "github-issue-opened"
        })
      )
    ).resolves.toEqual({
      name: "github-issue-opened",
      prompt: "# Project override"
    });
  });

  it("renders prompt-preview with resolved shared variables", async () => {
    writeBuiltInPrompt(
      "github-issue-opened",
      ["Issue URL: {{url}}", "Rules:", "{{custom_project_rules}}", "{{response_style}}"].join("\n")
    );
    vol.fromJSON({
      "/repo/.github/workflows/variables.yaml": [
        "custom_project_rules: |",
        "  Check docs/internal.md first.",
        ""
      ].join("\n")
    });

    const promptPreviewCommand = getCommand(["prompt-preview"]);

    await expect(
      promptPreviewCommand.handler(
        createContext(
          {
            name: "github-issue-opened"
          },
          {
            GITHUB_REPOSITORY: "acme/app",
            ISSUE_NUMBER: "188"
          }
        )
      )
    ).resolves.toEqual({
      name: "github-issue-opened",
      prompt: [
        "Issue URL: https://github.com/acme/app/issues/188",
        "Rules:",
        "Check docs/internal.md first.",
        "",
        "- Start with a direct answer or decision.",
        "- Keep it concise.",
        "- Use short Markdown sections only when they improve clarity.",
        ""
      ].join("\n")
    });
  });

  it("composes {{yield}} before rendering Mustache variables in prompt-preview", async () => {
    writeBuiltInPrompt(
      "github-issue-opened",
      [
        "Read {{url}} and make the smallest safe change.",
        "",
        "{{yield}}",
        "",
        "Always explain what changed in {{repo}}."
      ].join("\n")
    );
    vol.fromJSON({
      "/repo/.github/workflows/poe-code-github-issue-opened.md": [
        "---",
        "extends: true",
        "---",
        "Focus on test coverage for {{issue.title}}."
      ].join("\n")
    });

    const promptPreviewCommand = getCommand(["prompt-preview"]);

    await expect(
      promptPreviewCommand.handler(
        createContext(
          {
            name: "github-issue-opened"
          },
          {
            GITHUB_REPOSITORY: "acme/app",
            ISSUE_NUMBER: "188",
            ISSUE_TITLE: "Can I configure paths for planning docs on ralph?"
          }
        )
      )
    ).resolves.toEqual({
      name: "github-issue-opened",
      prompt: [
        "Read https://github.com/acme/app/issues/188 and make the smallest safe change.",
        "",
        "Focus on test coverage for Can I configure paths for planning docs on ralph?.",
        "",
        "Always explain what changed in acme/app."
      ].join("\n")
    });
  });

  it("renders built-in gh guidance that avoids shell-mangled GitHub bodies", async () => {
    writeBuiltInPrompt(
      "github-issue-opened",
      readFileSync(path.join(promptDir, "github-issue-opened.md"), "utf8")
    );

    const promptPreviewCommand = getCommand(["prompt-preview"]);
    const result = await promptPreviewCommand.handler(
      createContext(
        {
          name: "github-issue-opened"
        },
        {
          GITHUB_REPOSITORY: "acme/app",
          ISSUE_NUMBER: "188"
        }
      )
    );

    expect(result.prompt).toContain("Use the `gh` CLI for all GitHub operations");
    expect(result.prompt).toContain("--body-file");
    expect(result.prompt).toContain("quoted heredoc");
    expect(result.prompt).toContain("gh issue view");
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
        timeoutMs: workflowSubprocessTimeoutMs,
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

  it("previews sourced automation runs without executing source commands", async () => {
    writeBuiltInPrompt(
      "fix-vulnerabilities",
      ["---", "source: gh api repos/{owner}/{repo}/alerts", "---", "Fix {{item}}"].join("\n")
    );

    const result = await getCommand(["run"]).handler(
      createContext(
        { name: "fix-vulnerabilities", cwd: "/repo", dryRun: true },
        { GITHUB_REPOSITORY: "acme/app" },
        { poeApiKey: "poe-key" }
      )
    );

    expect(spawnState.runCommand).not.toHaveBeenCalled();
    expect(spawnState.spawn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, automation: "fix-vulnerabilities" });
  });

  it("uses the run agent override when automation discovery supplied the default agent", async () => {
    writeBuiltInPrompt("update-documentation", "Update the docs.");

    const result = await getCommand(["run"]).handler(
      createContext(
        { name: "update-documentation", agent: "claude-code", cwd: "/repo", dryRun: true },
        { GITHUB_REPOSITORY: "acme/app" },
        { poeApiKey: "poe-key" }
      )
    );

    expect(result).toMatchObject({ dryRun: true, automation: "update-documentation", agent: "claude-code" });
  });

  it("prepare fails when POE_API_KEY is missing", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");

    const setupAgentCommand = getCommand(["prepare"]);

    await expect(
      setupAgentCommand.handler(createContext({ name: "github-issue-opened" }))
    ).rejects.toThrow("Missing required environment variable: POE_API_KEY");
  });

  it("installs and configures the resolved workflow agent", async () => {
    writeBuiltInPrompt(
      "fix-vulnerabilities",
      ["---", "agent: claude-code", "---", "Fix dependencies"].join("\n")
    );

    const setupAgentCommand = getCommand(["prepare"]);

    await setupAgentCommand.handler(
      createContext(
        { name: "fix-vulnerabilities" },
        { POE_API_KEY: "key" }
      )
    );

    expect(spawnState.runCommand).toHaveBeenNthCalledWith(
      1,
      "poe-code",
      ["install", "claude-code", "--yes"],
      expect.objectContaining({ cwd: "/repo", timeoutMs: workflowSubprocessTimeoutMs })
    );
    expect(spawnState.runCommand).toHaveBeenNthCalledWith(
      2,
      "poe-code",
      ["configure", "claude-code", "--yes"],
      expect.objectContaining({ cwd: "/repo", timeoutMs: workflowSubprocessTimeoutMs })
    );
  });

  it("defaults prepare to codex when the automation does not declare an agent", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");

    const setupAgentCommand = getCommand(["prepare"]);

    await setupAgentCommand.handler(
      createContext(
        { name: "github-issue-opened" },
        { POE_API_KEY: "key" }
      )
    );

    expect(spawnState.runCommand).toHaveBeenNthCalledWith(
      1,
      "poe-code",
      ["install", "codex", "--yes"],
      expect.objectContaining({ cwd: "/repo", timeoutMs: workflowSubprocessTimeoutMs })
    );
    expect(spawnState.runCommand).toHaveBeenNthCalledWith(
      2,
      "poe-code",
      ["configure", "codex", "--yes"],
      expect.objectContaining({ cwd: "/repo", timeoutMs: workflowSubprocessTimeoutMs })
    );
  });

  it("previews prepare without installing or configuring an agent", async () => {
    writeBuiltInPrompt("update-dependencies", "# Prompt");

    const result = await getCommand(["prepare"]).handler(
      createContext({ name: "update-dependencies", dryRun: true }, { POE_API_KEY: "key" })
    );

    expect(spawnState.runCommand).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, agent: "codex", automation: "update-dependencies" });
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
        createContext(
          { name: "github-issue-opened" },
          { POE_API_KEY: "key" }
        )
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

    try {
      await runCommand.handler(
        createContext(
          { cwd: "/repo" },
          { GITHUB_REPOSITORY: "acme/app", ISSUE_NUMBER: "7" },
          { poeApiKey: "key" }
        )
      );
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
    }

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
      "/repo/.github/workflows/poe-code-alpha.md": "# Local"
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
          { name: "alpha", agent: "codex", source: "direct" },
          { name: "beta", agent: "codex", source: "direct" }
        ]
      })
    );
    expect(logger.message).toHaveBeenCalledWith("automation table");
  });

  it("installs a caller workflow without copying a prompt file", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "caller");

    const installCommand = getCommand(["install"]);

    const result = await installCommand.handler(
      createContext({
        name: "github-issue-opened"
      })
    );

    expect(vol.existsSync("/repo/.github/workflows/poe-code-github-issue-opened.md")).toBe(false);
    expect(readRepoFile("/repo/.github/workflows/poe-code-github-issue-opened.yml")).toContain(
      "uses: poe-platform/poe-code/.github/workflows/gh-github-issue-opened.yml@main"
    );
    expect(readRepoFile("/repo/.github/workflows/poe-code-github-issue-opened.yml")).not.toContain(
      "npm install -g poe-code@latest"
    );
    expect(readRepoFile("/repo/.github/workflows/variables.yaml")).toContain(
      "# response_style: |"
    );
    expect(readRepoFile("/repo/.github/workflows/README.md")).toContain(
      "| `poe-code github-workflows variables` | List shared prompt variables and where each value comes from |"
    );
    expect(result).toMatchObject({
      installations: [
        {
          name: "github-issue-opened",
          promptContent: "# Prompt",
          promptPath: undefined,
          ejected: false
        }
      ],
      readmePath: "/repo/.github/workflows/README.md",
      variablesPath: "/repo/.github/workflows/variables.yaml"
    });
  });

  it("previews workflow installation without writing files", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "caller");

    const result = await getCommand(["install"]).handler(
      createContext({ name: "github-issue-opened", dryRun: true })
    );

    expect(result).toMatchObject({ dryRun: true });
    expect(vol.existsSync("/repo/.github/workflows/poe-code-github-issue-opened.yml")).toBe(false);
    expect(vol.existsSync("/repo/.github/workflows/variables.yaml")).toBe(false);
    expect(vol.existsSync("/repo/.github/workflows/README.md")).toBe(false);
  });

  it("rejects a symlinked workflow install destination", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "caller");
    vol.mkdirSync("/repo/.github/workflows", { recursive: true });
    vol.writeFileSync("/outside-workflow.yml", "sentinel");
    vol.symlinkSync("/outside-workflow.yml", "/repo/.github/workflows/poe-code-github-issue-opened.yml");

    await expect(
      getCommand(["install"]).handler(createContext({ name: "github-issue-opened" }))
    ).rejects.toThrow(/symbolic link/i);
    expect(readRepoFile("/outside-workflow.yml")).toBe("sentinel");
  });

  it("does not follow a workflow destination symlink inserted before publish", async () => {
    const workflowPath = "/repo/.github/workflows/poe-code-github-issue-opened.yml";
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "caller");
    vol.mkdirSync("/repo/.github/workflows", { recursive: true });
    vol.writeFileSync("/outside-workflow.yml", "sentinel");
    fileSystemState.symlinkRacePath = workflowPath;
    fileSystemState.symlinkRaceTarget = "/outside-workflow.yml";

    await getCommand(["install"]).handler(createContext({ name: "github-issue-opened" }));

    expect(readRepoFile("/outside-workflow.yml")).toBe("sentinel");
    expect(vol.lstatSync(workflowPath).isSymbolicLink()).toBe(false);
    expect(readRepoFile(workflowPath)).toContain(
      "poe-code github-workflows install github-issue-opened"
    );
  });

  it("rejects a symlinked .github parent during workflow install", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "caller");
    vol.mkdirSync("/repo", { recursive: true });
    vol.mkdirSync("/outside-github", { recursive: true });
    vol.symlinkSync("/outside-github", "/repo/.github");

    await expect(
      getCommand(["install"]).handler(createContext({ name: "github-issue-opened" }))
    ).rejects.toThrow(/symbolic link/i);
    expect(vol.existsSync("/outside-github/workflows/poe-code-github-issue-opened.yml")).toBe(false);
    expect(vol.existsSync("/outside-github/workflows/variables.yaml")).toBe(false);
    expect(vol.existsSync("/outside-github/workflows/README.md")).toBe(false);
  });

  it("shows the default prompt in a note and suggests eject for customization", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "caller");

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
    expect(note).toHaveBeenCalledWith("# Prompt", "Default prompt");
    expect(logger.message).toHaveBeenCalledWith(
      "To customize the prompt, run: poe-code github-workflows install github-issue-opened --eject"
    );
  });

  it("installs all automations when install is called without a name", async () => {
    for (const name of installableAutomationNames) {
      writeBuiltInPrompt(name, `# Prompt for ${name}`);
      seedWorkflowTemplate(name, "caller");
    }

    const installCommand = getCommand(["install"]);

    const result = await installCommand.handler(createContext({}));

    for (const name of installableAutomationNames) {
      expect(vol.existsSync(`/repo/.github/workflows/poe-code-${name}.yml`)).toBe(true);
    }

    expect(result.installations).toHaveLength(installableAutomationNames.length);
    expect(result.variablesPath).toBe("/repo/.github/workflows/variables.yaml");
    expect(result.readmePath).toBe("/repo/.github/workflows/README.md");
  });

  it("labels a bulk dry run and frames the workflow paths in a panel", async () => {
    for (const name of installableAutomationNames) {
      writeBuiltInPrompt(name, `# Prompt for ${name}`);
      seedWorkflowTemplate(name, "caller");
    }

    const installCommand = getCommand(["install"]);
    const result = await installCommand.handler(createContext({ dryRun: true }));

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

    expect(logger.success).toHaveBeenCalledWith(
      `Would install ${installableAutomationNames.length} workflows.`
    );
    expect(logger.success).not.toHaveBeenCalledWith(
      expect.stringContaining(`Installed ${installableAutomationNames.length}`)
    );
    // Paths belong in a framed panel, not as bare unlabelled messages.
    const panel = note.mock.calls.find(([, title]) => title === "Workflows");
    expect(panel).toBeDefined();
    for (const name of installableAutomationNames) {
      expect(panel?.[0]).toContain(`poe-code-${name}.yml`);
      expect(logger.message).not.toHaveBeenCalledWith(
        `/repo/.github/workflows/poe-code-${name}.yml`
      );
    }
  });

  it("reports a bulk real install as installed", async () => {
    for (const name of installableAutomationNames) {
      writeBuiltInPrompt(name, `# Prompt for ${name}`);
      seedWorkflowTemplate(name, "caller");
    }

    const installCommand = getCommand(["install"]);
    const result = await installCommand.handler(createContext({}));

    const logger = {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      resolved: vi.fn(),
      errorResolved: vi.fn(),
      message: vi.fn()
    };

    installCommand.render.rich(result, {
      logger,
      note: vi.fn(),
      renderTable: vi.fn(),
      getTheme: vi.fn()
    });

    expect(logger.success).toHaveBeenCalledWith(
      `Installed ${installableAutomationNames.length} workflows.`
    );
  });

  it("rolls back earlier workflows when a later bulk install write fails", async () => {
    for (const name of installableAutomationNames) {
      writeBuiltInPrompt(name, `# Prompt for ${name}`);
      seedWorkflowTemplate(name, "caller");
    }
    const failingPath = "/repo/.github/workflows/poe-code-github-issue-comment-created.yml";
    let partialTempPath: string | undefined;
    fileSystemState.failingWritePath = failingPath;
    fileSystemState.beforeFailingWrite = (targetPath, content, options) => {
      if (targetPath.startsWith(`${failingPath}.`) && targetPath.endsWith(".tmp")) {
        partialTempPath = targetPath;
        vol.writeFileSync(
          targetPath,
          typeof content === "string" ? content.slice(0, 16) : Buffer.from(content).subarray(0, 16),
          options
        );
      }
    };

    await expect(getCommand(["install"]).handler(createContext({}))).rejects.toThrow(
      "injected workflow write failure"
    );

    expect(partialTempPath).toMatch(new RegExp(`^${failingPath.replaceAll(".", "\\.")}\\.`));
    expect(vol.existsSync(partialTempPath ?? "")).toBe(false);
    expect(vol.existsSync("/repo/.github/workflows/poe-code-fix-vulnerabilities.yml")).toBe(false);
  });

  it("removes partial workflow temp files when write errors only inherit existing-path codes", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "caller");
    const failingPath = "/repo/.github/workflows/poe-code-github-issue-opened.yml";
    let partialTempPath: string | undefined;
    fileSystemState.failingWritePath = failingPath;
    fileSystemState.beforeFailingWrite = (targetPath, content, options) => {
      if (targetPath.startsWith(`${failingPath}.`) && targetPath.endsWith(".tmp")) {
        partialTempPath = targetPath;
        vol.writeFileSync(
          targetPath,
          typeof content === "string" ? content.slice(0, 16) : Buffer.from(content).subarray(0, 16),
          options
        );
      }
    };

    await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
      await expect(
        getCommand(["install"]).handler(createContext({ name: "github-issue-opened" }))
      ).rejects.toThrow("injected workflow write failure");
    });

    expect(partialTempPath).toMatch(new RegExp(`^${failingPath.replaceAll(".", "\\.")}\\.`));
    expect(vol.existsSync(partialTempPath ?? "")).toBe(false);
  });

  it("does not generate a broken workflow_dispatch trigger for pull-request-opened installs", async () => {
    writeBuiltInPrompt("github-pull-request-opened", "# Prompt");
    seedWorkflowTemplate("github-pull-request-opened", "caller");

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

  it("installs the issue comment workflow as a caller workflow", async () => {
    writeBuiltInPrompt("github-issue-comment-created", "# Prompt");
    seedWorkflowTemplate("github-issue-comment-created", "caller");

    const installCommand = getCommand(["install"]);

    await installCommand.handler(
      createContext({
        name: "github-issue-comment-created"
      })
    );

    const workflow = readRepoFile("/repo/.github/workflows/poe-code-github-issue-comment-created.yml");
    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain(
      "uses: poe-platform/poe-code/.github/workflows/gh-github-issue-comment-created.yml@main"
    );
    expect(workflow).toContain(
      "COMMENT_AUTHOR_ASSOCIATION: ${{ github.event.comment.author_association }}"
    );
    expect(workflow).not.toContain("workflow_call:");
  });

  it("installs an ejected workflow and prompt next to the yaml file", async () => {
    writeBuiltInPrompt("github-issue-comment-created", "# Prompt");
    seedWorkflowTemplate("github-issue-comment-created", "ejected");

    const installCommand = getCommand(["install"]);

    await installCommand.handler(
      createContext({
        name: "github-issue-comment-created",
        eject: true
      })
    );

    const workflow = readRepoFile("/repo/.github/workflows/poe-code-github-issue-comment-created.yml");
    expect(readRepoFile("/repo/.github/workflows/poe-code-github-issue-comment-created.md")).toContain("# Prompt");
    expect(workflow).toContain(
      "poe-code github-workflows require-user-allow poe-code-github-issue-comment-created"
    );
    expect(workflow).toContain(
      "poe-code github-workflows prepare poe-code-github-issue-comment-created"
    );
  });

  it("rolls back an ejected workflow when copying its prompt fails", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "ejected");
    fileSystemState.failingWritePath = "/repo/.github/workflows/poe-code-github-issue-opened.md";

    await expect(
      getCommand(["install"]).handler(createContext({ name: "github-issue-opened", eject: true }))
    ).rejects.toThrow("injected workflow write failure");

    expect(vol.existsSync("/repo/.github/workflows/poe-code-github-issue-opened.yml")).toBe(false);
  });

  it("rolls back a workflow when writing shared support files fails", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "caller");
    fileSystemState.failingWritePath = "/repo/.github/workflows/variables.yaml";

    await expect(
      getCommand(["install"]).handler(createContext({ name: "github-issue-opened" }))
    ).rejects.toThrow("injected workflow write failure");

    expect(vol.existsSync("/repo/.github/workflows/poe-code-github-issue-opened.yml")).toBe(false);
  });

  it("rejects a symlinked ejected prompt destination", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "ejected");
    vol.mkdirSync("/repo/.github/workflows", { recursive: true });
    vol.writeFileSync("/outside-prompt.md", "sentinel");
    vol.symlinkSync("/outside-prompt.md", "/repo/.github/workflows/poe-code-github-issue-opened.md");

    await expect(
      getCommand(["install"]).handler(createContext({ name: "github-issue-opened", eject: true }))
    ).rejects.toThrow(/symbolic link/i);
    expect(readRepoFile("/outside-prompt.md")).toBe("sentinel");
  });

  it("rejects a symlinked workflows parent during ejected install", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "ejected");
    vol.mkdirSync("/repo/.github", { recursive: true });
    vol.mkdirSync("/outside-workflows", { recursive: true });
    vol.symlinkSync("/outside-workflows", "/repo/.github/workflows");

    await expect(
      getCommand(["install"]).handler(createContext({ name: "github-issue-opened", eject: true }))
    ).rejects.toThrow(/symbolic link/i);
    expect(vol.existsSync("/outside-workflows/poe-code-github-issue-opened.yml")).toBe(false);
    expect(vol.existsSync("/outside-workflows/poe-code-github-issue-opened.md")).toBe(false);
  });

  it("rejects symlinked workflow support destinations", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "caller");
    vol.mkdirSync("/repo/.github/workflows", { recursive: true });
    vol.writeFileSync("/outside-variables.yaml", "sentinel variables");
    vol.writeFileSync("/outside-readme.md", "sentinel readme");
    vol.symlinkSync("/outside-variables.yaml", "/repo/.github/workflows/variables.yaml");
    vol.symlinkSync("/outside-readme.md", "/repo/.github/workflows/README.md");

    await expect(
      getCommand(["install"]).handler(createContext({ name: "github-issue-opened" }))
    ).rejects.toThrow(/symbolic link/i);
    expect(readRepoFile("/outside-variables.yaml")).toBe("sentinel variables");
    expect(readRepoFile("/outside-readme.md")).toBe("sentinel readme");
  });

  it("does not roll back through a symlinked workflows parent", async () => {
    writeBuiltInPrompt("github-issue-opened", "# Prompt");
    seedWorkflowTemplate("github-issue-opened", "caller");
    vol.mkdirSync("/outside-rollback", { recursive: true });
    fileSystemState.failingWritePath = "/repo/.github/workflows/variables.yaml";
    fileSystemState.beforeFailingWrite = () => {
      vol.rmSync("/repo/.github/workflows", { recursive: true, force: true });
      vol.symlinkSync("/outside-rollback", "/repo/.github/workflows");
    };

    await expect(
      getCommand(["install"]).handler(createContext({ name: "github-issue-opened" }))
    ).rejects.toThrow(/symbolic link/i);
    expect(vol.existsSync("/outside-rollback/poe-code-github-issue-opened.yml")).toBe(false);
    expect(vol.existsSync("/outside-rollback/variables.yaml")).toBe(false);
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
      "/repo/.github/workflows/poe-code-github-issue-opened.md": "prompt"
    });

    const uninstallCommand = getCommand(["uninstall"]);

    await uninstallCommand.handler(
      createContext({
        name: "github-issue-opened"
      })
    );

    expect(vol.existsSync("/repo/.github/workflows/poe-code-github-issue-opened.yml")).toBe(false);
    expect(readRepoFile("/repo/.github/workflows/poe-code-github-issue-opened.md")).toBe("prompt");
  });

  it("previews workflow uninstall without deleting the workflow", async () => {
    vol.fromJSON({
      "/repo/.github/workflows/poe-code-github-issue-opened.yml": "workflow"
    });

    const result = await getCommand(["uninstall"]).handler(
      createContext({ name: "github-issue-opened", dryRun: true })
    );

    expect(result).toMatchObject({ dryRun: true });
    expect(readRepoFile("/repo/.github/workflows/poe-code-github-issue-opened.yml")).toBe("workflow");
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
      "/repo/.github/workflows/poe-code-github-issue-comment-created.md": [
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
    ).rejects.toThrow('Automation "github-issue-comment-created" does not allow COMMENT_AUTHOR_ASSOCIATION "MEMBER". Allowed values: OWNER.');

    await expect(
      requireCommentPrefixCommand.handler(
        createContext(
          { name: "poe-code-github-issue-comment-created" },
          { COMMENT_BODY: "/poe please review" }
        )
      )
    ).rejects.toThrow(
      'Automation "github-issue-comment-created" requires COMMENT_BODY to start with "poe-code".'
    );
  });

  it("lists resolved variable statuses with sources", async () => {
    vol.fromJSON({
      "/repo/.github/workflows/variables.yaml": [
        "verify_before_responding: |",
        "  Check changed files first.",
        'skill_github_cli: ""',
        "custom_project_rules: |",
        "  Follow docs/internal.md.",
        ""
      ].join("\n")
    });

    const variablesCommand = getCommand(["variables"]);
    const result = await variablesCommand.handler(createContext({}));
    const renderTable = vi.fn(() => "variable table");
    const logger = {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      resolved: vi.fn(),
      errorResolved: vi.fn(),
      message: vi.fn()
    };

    variablesCommand.render.rich(result, {
      logger,
      note: vi.fn(),
      renderTable,
      getTheme: () => ({
        header: (value: string) => value,
        muted: (value: string) => value
      })
    });

    expect(result).toEqual([
      { name: "response_style", source: "built-in", status: "default" },
      {
        name: "verify_before_responding",
        source: ".github/workflows/variables.yaml",
        status: "overridden"
      },
      {
        name: "skill_github_cli",
        source: ".github/workflows/variables.yaml",
        status: "disabled"
      },
      { name: "pull_request_guidelines", source: "built-in", status: "default" },
      { name: "code_review_guidelines", source: "built-in", status: "default" },
      {
        name: "custom_project_rules",
        source: ".github/workflows/variables.yaml",
        status: "custom"
      }
    ]);
    expect(renderTable).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: [
          expect.objectContaining({ name: "name", title: "Name" }),
          expect.objectContaining({ name: "status", title: "Status" }),
          expect.objectContaining({ name: "source", title: "Source" })
        ]
      })
    );
    expect(logger.message).toHaveBeenCalledWith("variable table");
  });
});
