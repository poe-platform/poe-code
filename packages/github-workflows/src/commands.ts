import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";
import type { McpSpawnConfig, SpawnResult } from "@poe-code/agent-spawn";
import { runCommand, spawn } from "@poe-code/agent-spawn";
import { S } from "@poe-code/cmdkit-schema";
import { UserError, defineCommand, defineGroup } from "@poe-code/cmdkit";
import type { Group } from "@poe-code/cmdkit";
import { cancel, isCancel, select } from "@poe-code/design-system";
import { discoverAutomations, loadAutomation } from "./discover.js";
import { checkUserAllow } from "./exec/check-user-allow.js";
import { requireCommentPrefix } from "./exec/require-comment-prefix.js";
import type { AutomationDefinition } from "./types.js";

const builtInPromptsDirCandidates = [
  fileURLToPath(new URL("./prompts", import.meta.url)),
  fileURLToPath(new URL("../src/prompts", import.meta.url))
];

const builtInWorkflowTemplatesDirCandidates = [
  fileURLToPath(new URL("./workflow-templates", import.meta.url)),
  fileURLToPath(new URL("../src/workflow-templates", import.meta.url))
];
const originalMustacheEscape = Mustache.escape;

interface RunItemResult {
  prompt: string;
  result: SpawnResult;
}

interface RunAutomationResult {
  agent: string;
  automation: string;
  items: RunItemResult[];
}

const installableAutomations = [
  "fix-vulnerabilities",
  "github-issue-comment-created",
  "github-issue-opened",
  "github-pull-request-opened",
  "github-pull-request-synchronized",
  "update-dependencies",
  "update-documentation"
] as const;

function formatLabel(name: string): string {
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (name.startsWith("github-")) {
    return `GitHub: ${name.slice("github-".length).split("-").map(capitalize).join(" ")}`;
  }
  return name.split("-").map(capitalize).join(" ");
}


const runCommandDef = defineCommand({
  name: "run",
  description: "Run a GitHub automation.",
  positional: ["name"],
  params: S.Object({
    name: S.Optional(S.String()),
    agent: S.Optional(S.String()),
    model: S.Optional(S.String()),
    mode: S.Optional(S.Enum(["yolo", "edit", "read"] as const)),
    cwd: S.Optional(S.String())
  }),
  secrets: {
    poeApiKey: { env: "POE_API_KEY" },
    githubToken: { env: "GITHUB_TOKEN", optional: true }
  },
  scope: ["cli", "sdk"],
  handler: async ({ params, env, secrets }) => {
    const cwd = resolveCwd(params.cwd);
    const name =
      params.name ??
      (await selectAutomationName(
        "Pick a workflow to run",
        await discoverAutomations(await resolveBuiltInPromptsDir(), projectPromptsDir(cwd))
      ));
    const automation = await loadNamedAutomation(name, cwd);
    const agent = automation.agent ?? params.agent ?? "codex";
    const sharedTemplateContext = buildTemplateContext(env);

    if (automation.source === undefined) {
      const prompt = renderPrompt(automation.prompt, sharedTemplateContext);
      return {
        automation: automation.name,
        agent,
        items: [
          {
            prompt,
            result: await spawn(agent, {
              prompt,
              cwd,
              ...(params.model === undefined ? {} : { model: params.model }),
              ...(params.mode === undefined ? {} : { mode: params.mode }),
              ...(automation.mcp === undefined
                ? {}
                : { mcpServers: resolveMcpConfig(automation.mcp, env) })
            })
          }
        ]
      } satisfies RunAutomationResult;
    }

    const sourceResult = await runCommand("sh", ["-c", resolveSourceCommand(automation.source, env)], {
      cwd,
      env: buildCommandEnv(env, secrets)
    });

    if (sourceResult.exitCode !== 0) {
      throw new UserError(
        `Automation "${automation.name}" source command failed with exit code ${sourceResult.exitCode}.`
      );
    }

    const items = parseSourceItems(automation.name, sourceResult.stdout);
    const results: RunItemResult[] = [];

    for (const item of items) {
      const prompt = renderPrompt(automation.prompt, buildPerItemTemplateContext(item, sharedTemplateContext));
      results.push({
        prompt,
        result: await spawn(agent, {
          prompt,
          cwd,
          ...(params.model === undefined ? {} : { model: params.model }),
          ...(params.mode === undefined ? {} : { mode: params.mode }),
          ...(automation.mcp === undefined
            ? {}
            : { mcpServers: resolveMcpConfig(automation.mcp, env) })
        })
      });
    }

    return {
      automation: automation.name,
      agent,
      items: results
    } satisfies RunAutomationResult;
  },
  render: {
    rich: (result: RunAutomationResult, { logger }) => {
      const total = result.items.length;
      const succeeded = result.items.filter((item) => item.result.exitCode === 0).length;
      logger.success(
        `Ran automation "${result.automation}" with agent "${result.agent}" for ${total} item${total === 1 ? "" : "s"}.`
      );
      logger.message(`${succeeded}/${total} run${total === 1 ? "" : "s"} exited successfully.`);
    },
    json: (result: RunAutomationResult) => result
  }
});

const listCommand = defineCommand({
  name: "list",
  description: "List available automations.",
  params: S.Object({}),
  scope: ["cli", "sdk"],
  handler: async () => discoverAutomations(await resolveBuiltInPromptsDir(), projectPromptsDir(resolveCwd())),
  render: {
    rich: (automations: AutomationDefinition[], { logger, renderTable, getTheme }) => {
      logger.message(
        renderTable({
          theme: getTheme(),
          columns: [
            { name: "name", title: "Name", alignment: "left", maxLen: 40 },
            { name: "agent", title: "Agent", alignment: "left", maxLen: 24 },
            { name: "source", title: "Source", alignment: "left", maxLen: 12 }
          ],
          rows: automations.map((automation) => ({
            name: automation.name,
            agent: automation.agent ?? "",
            source: automation.source === undefined ? "direct" : "source"
          }))
        })
      );
    },
    json: (automations: AutomationDefinition[]) => automations
  }
});

const installCommand = defineCommand({
  name: "install",
  description: "Install an automation workflow into the current repo.",
  positional: ["name"],
  params: S.Object({
    name: S.Optional(S.Enum(installableAutomations)),
    eject: S.Optional(S.Boolean())
  }),
  scope: ["cli"],
  handler: async ({ params }) => {
    const name =
      params.name ??
      (await selectAutomationName(
        "Pick a GitHub workflow to install",
        await discoverAutomations(await resolveBuiltInPromptsDir())
      ));
    const variant = params.eject === true ? "ejected" : "caller";
    const workflowTemplate = await readBuiltInWorkflowTemplate(name, variant);
    const rawPrompt = await readBuiltInPromptFile(name);
    const cwd = resolveCwd();
    const promptPath = path.join(projectPromptsDir(cwd), `${name}.md`);
    const workflowPath = path.join(cwd, ".github", "workflows", `gh-${name}.yml`);

    await mkdir(path.dirname(promptPath), { recursive: true });
    await mkdir(path.dirname(workflowPath), { recursive: true });
    await writeFile(promptPath, rawPrompt, "utf8");
    await writeFile(workflowPath, workflowTemplate, "utf8");

    return {
      workflowPath,
      promptPath,
      ejected: params.eject === true
    };
  },
  render: {
    rich: (result: { workflowPath: string; promptPath: string; ejected: boolean }, { logger }) => {
      logger.success(`Installed workflow at ${result.workflowPath}`);
      logger.message(`Prompt copied to ${result.promptPath}`);
    },
    json: (result: { workflowPath: string; promptPath: string; ejected: boolean }) => result
  }
});

const uninstallCommand = defineCommand({
  name: "uninstall",
  description: "Remove an installed automation workflow from the current repo.",
  positional: ["name"],
  params: S.Object({
    name: S.Optional(S.Enum(installableAutomations))
  }),
  scope: ["cli"],
  handler: async ({ params }) => {
    const name =
      params.name ??
      (await selectAutomationName(
        "Pick a GitHub workflow to uninstall",
        await discoverAutomations(await resolveBuiltInPromptsDir())
      ));
    const workflowPath = path.join(resolveCwd(), ".github", "workflows", `gh-${name}.yml`);

    try {
      await unlink(workflowPath);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }

    return {
      workflowPath
    };
  },
  render: {
    rich: (result: { workflowPath: string }, { logger }) => {
      logger.success(`Removed workflow ${result.workflowPath}`);
    },
    json: (result: { workflowPath: string }) => result
  }
});

const checkUserAllowCommand = defineCommand({
  name: "check-user-allow",
  description: "Fail when COMMENT_AUTHOR_ASSOCIATION is not allowed by the automation frontmatter.",
  positional: ["name"],
  params: S.Object({
    name: S.String()
  }),
  scope: ["cli"],
  handler: async ({ params, env }) => {
    const automation = await loadNamedAutomation(params.name, resolveCwd());
    checkUserAllow(automation, env.get("COMMENT_AUTHOR_ASSOCIATION"));
    return null;
  }
});

const requireCommentPrefixCommand = defineCommand({
  name: "require-comment-prefix",
  description: "Fail when COMMENT_BODY does not start with the automation prefix frontmatter.",
  positional: ["name"],
  params: S.Object({
    name: S.String()
  }),
  scope: ["cli"],
  handler: async ({ params, env }) => {
    const automation = await loadNamedAutomation(params.name, resolveCwd());
    requireCommentPrefix(automation, env.get("COMMENT_BODY"));
    return null;
  }
});

const promptPreviewCommand = defineCommand({
  name: "prompt-preview",
  description: "Preview the resolved prompt for an automation.",
  positional: ["name"],
  params: S.Object({
    name: S.String()
  }),
  scope: ["cli", "sdk"],
  handler: async ({ params }) => {
    const automation = await loadNamedAutomation(params.name, resolveCwd());
    return { name: automation.name, prompt: automation.prompt };
  },
  render: {
    rich: (result: { name: string; prompt: string }, { logger }) => {
      logger.message(result.prompt);
    },
    json: (result: { name: string; prompt: string }) => result
  }
});

const execGroup = defineGroup({
  name: "exec",
  description: "Workflow step helpers.",
  scope: ["cli"],
  children: [checkUserAllowCommand, requireCommentPrefixCommand]
});

export const ghGroup: Group = defineGroup({
  name: "github-workflows",
  aliases: ["gh"],
  description: "GitHub workflow automations.",
  children: [runCommandDef, listCommand, installCommand, uninstallCommand, promptPreviewCommand, execGroup],
  default: runCommandDef
});

async function loadNamedAutomation(name: string, cwd: string): Promise<AutomationDefinition> {
  const automation = await loadAutomation(name, [projectPromptsDir(cwd), await resolveBuiltInPromptsDir()]);
  if (automation === undefined) {
    throw new UserError(`Automation "${name}" was not found.`);
  }
  return automation;
}

async function readBuiltInPromptFile(name: string): Promise<string> {
  try {
    return await readFile(path.join(await resolveBuiltInPromptsDir(), `${name}.md`), "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new UserError(`Automation "${name}" was not found.`);
    }
    throw error;
  }
}

async function readBuiltInWorkflowTemplate(name: string, variant: "caller" | "ejected"): Promise<string> {
  const templatePath = path.join(await resolveBuiltInWorkflowTemplatesDir(), `${name}.${variant}.yml`);
  try {
    const content = await readFile(templatePath, "utf8");
    const header =
      variant === "ejected"
        ? `# Auto-generated by: poe-code github-workflows install ${name}\n# Edit .poe-code/github-workflows/${name}.md to customize the prompt.\n`
        : `# Auto-generated by: poe-code github-workflows install ${name}\n`;
    return header + content;
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new UserError(`Automation "${name}" cannot be installed.`);
    }
    throw error;
  }
}

async function resolveBuiltInWorkflowTemplatesDir(): Promise<string> {
  for (const candidate of builtInWorkflowTemplatesDirCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
  }

  return builtInWorkflowTemplatesDirCandidates[0];
}

function projectPromptsDir(cwd: string): string {
  return path.join(cwd, ".poe-code", "github-workflows");
}

async function resolveBuiltInPromptsDir(): Promise<string> {
  for (const candidate of builtInPromptsDirCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
  }

  return builtInPromptsDirCandidates[0];
}

function resolveCwd(cwd?: string): string {
  return cwd ?? process.cwd();
}

function buildCommandEnv(
  env: { get(key: string): string | undefined },
  secrets: Record<string, string | undefined>
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {
    POE_API_KEY: secrets.poeApiKey,
    GITHUB_TOKEN: secrets.githubToken
  };

  for (const key of [
    "GITHUB_REPOSITORY",
    "ISSUE_NUMBER",
    "ISSUE_TITLE",
    "COMMENT_AUTHOR",
    "COMMENT_BODY",
    "PR_NUMBER",
    "PR_TITLE",
    "PR_AUTHOR"
  ]) {
    const value = env.get(key);
    if (value !== undefined) {
      values[key] = value;
    }
  }

  return values;
}

function buildTemplateContext(env: { get(key: string): string | undefined }): Record<string, unknown> {
  const repo = env.get("GITHUB_REPOSITORY");
  const issueNumber = env.get("ISSUE_NUMBER");
  const prNumber = env.get("PR_NUMBER");

  return {
    ...(repo === undefined ? {} : { repo }),
    ...(buildUrl(repo, issueNumber, prNumber) === undefined
      ? {}
      : { url: buildUrl(repo, issueNumber, prNumber) }),
    issue: pruneUndefined({
      number: issueNumber,
      title: env.get("ISSUE_TITLE")
    }),
    comment: pruneUndefined({
      author: env.get("COMMENT_AUTHOR"),
      body: env.get("COMMENT_BODY")
    }),
    pr: pruneUndefined({
      number: prNumber,
      title: env.get("PR_TITLE"),
      author: env.get("PR_AUTHOR")
    })
  };
}

function buildUrl(
  repo: string | undefined,
  issueNumber: string | undefined,
  prNumber: string | undefined
): string | undefined {
  if (repo === undefined) {
    return undefined;
  }

  if (issueNumber !== undefined) {
    return `https://github.com/${repo}/issues/${issueNumber}`;
  }

  if (prNumber !== undefined) {
    return `https://github.com/${repo}/pull/${prNumber}`;
  }

  return undefined;
}

function pruneUndefined(record: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

function parseSourceItems(name: string, stdout: string): unknown[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new UserError(`Automation "${name}" source command did not return valid JSON.`);
  }

  if (!Array.isArray(parsed)) {
    throw new UserError(`Automation "${name}" source command must return a JSON array.`);
  }

  return parsed;
}

function buildPerItemTemplateContext(
  item: unknown,
  sharedContext: Record<string, unknown>
): Record<string, unknown> {
  if (isRecord(item)) {
    return {
      ...sharedContext,
      ...item
    };
  }

  return {
    ...sharedContext,
    item
  };
}

function renderPrompt(template: string, view: Record<string, unknown>): string {
  Mustache.escape = (value: string) => value;
  try {
    return Mustache.render(template, view);
  } finally {
    Mustache.escape = originalMustacheEscape;
  }
}

function resolveSourceCommand(
  source: string,
  env: { get(key: string): string | undefined }
): string {
  const repo = env.get("GITHUB_REPOSITORY");
  if (repo === undefined) {
    return source;
  }

  const slashIndex = repo.indexOf("/");
  if (slashIndex < 0) {
    return source.split("{repo}").join(repo);
  }

  const owner = repo.slice(0, slashIndex);
  const repoName = repo.slice(slashIndex + 1);

  return source.split("{owner}").join(owner).split("{repo}").join(repoName);
}

function resolveMcpConfig(
  mcp: McpSpawnConfig,
  env: { get(key: string): string | undefined }
): McpSpawnConfig {
  return Object.fromEntries(
    Object.entries(mcp).map(([serverName, server]) => [
      serverName,
      {
        command: server.command,
        ...(server.args === undefined ? {} : { args: [...server.args] }),
        ...(server.env === undefined
          ? {}
          : {
              env: Object.fromEntries(
                Object.entries(server.env).map(([key, value]) => [key, resolveEnvInterpolation(value, env)])
              )
            })
      }
    ])
  );
}

function resolveEnvInterpolation(
  value: string,
  env: { get(key: string): string | undefined }
): string {
  if (!value.startsWith("${{") || !value.endsWith("}}")) {
    return value;
  }

  const key = value.slice(3, -2).trim();
  return env.get(key) ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function selectAutomationName(message: string, automations: AutomationDefinition[]): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new UserError("Automation name is required.");
  }

  const selected = await select({
    message,
    options: automations.map((a) => ({ label: a.label ?? formatLabel(a.name), value: a.name }))
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    throw new UserError("Operation cancelled.");
  }

  return selected as string;
}
