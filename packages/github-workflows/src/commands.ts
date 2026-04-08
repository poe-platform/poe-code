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
import { runPreflightChecks } from "./preflight.js";
import { setupWorkflowAgent } from "./setup-agent.js";
import type { AutomationDefinition } from "./types.js";
import { generateProjectVariablesFile, loadVariableStatuses, loadVariables } from "./variables.js";

const UPSTREAM_REPO = "poe-platform/poe-code";

const builtInPromptsDirCandidates = [
  fileURLToPath(new URL("./prompts", import.meta.url)),
  fileURLToPath(new URL("../src/prompts", import.meta.url))
];

const builtInWorkflowTemplatesDirCandidates = [
  fileURLToPath(new URL("./workflow-templates", import.meta.url)),
  fileURLToPath(new URL("../src/workflow-templates", import.meta.url))
];
Mustache.escape = (value: string) => value;

interface RunItemResult {
  prompt: string;
  result: SpawnResult;
}

interface RunAutomationResult {
  agent: string;
  automation: string;
  items: RunItemResult[];
}

interface InstalledAutomationResult {
  name: string;
  workflowPath: string;
  promptPath?: string;
  ejected: boolean;
  promptContent: string;
}

interface InstallCommandResult {
  installations: InstalledAutomationResult[];
  readmePath: string;
  variablesPath: string;
}

const installableAutomations = [
  "fix-vulnerabilities",
  "github-issue-comment-created",
  "github-issue-opened",
  "github-pull-request-comment-created",
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
    name: S.Optional(S.String({ description: "Automation name to run" })),
    agent: S.Optional(S.String({ description: "Agent to run the automation with" })),
    model: S.Optional(S.String({ description: "Model override for the agent" })),
    mode: S.Optional(S.Enum(["yolo", "edit", "read"] as const, { description: "Permission mode (yolo | edit | read)" })),
    cwd: S.Optional(S.String({ description: "Working directory for the automation" }))
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
        await discoverAutomations(await resolveBuiltInPromptsDir(), ...projectPromptDirs(cwd))
      ));
    const automation = await loadNamedAutomation(name, cwd);
    const agent = automation.agent ?? params.agent ?? "codex";
    const variables = await loadVariables(await resolveBuiltInAssetsDir(), projectGitHubWorkflowsDir(cwd));
    const sharedTemplateContext = { ...variables, ...buildTemplateContext(env) };

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
  handler: async () => discoverAutomations(await resolveBuiltInPromptsDir(), ...projectPromptDirs(resolveCwd())),
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
  description: "Install one or all automation workflows into the current repo.",
  positional: ["name"],
  params: S.Object({
    name: S.Optional(
      S.Enum(installableAutomations, {
        description: "Pick a GitHub workflow to install",
        loadOptions: async () => {
          const automations = await discoverAutomations(await resolveBuiltInPromptsDir());
          return automations.map((a) => ({ label: a.label ?? formatLabel(a.name), value: a.name }));
        }
      })
    ),
    eject: S.Optional(S.Boolean())
  }),
  scope: ["cli"],
  handler: async ({ params }) => {
    const cwd = resolveCwd();
    const names = params.name === undefined ? [...installableAutomations] : [params.name];
    const installations: InstalledAutomationResult[] = [];

    for (const name of names) {
      installations.push(await installAutomation(name, cwd, params.eject === true));
    }

    const supportFiles = await ensureProjectSupportFiles(
      cwd,
      await loadVariables(await resolveBuiltInAssetsDir())
    );

    return {
      installations,
      ...supportFiles
    } satisfies InstallCommandResult;
  },
  render: {
    rich: (result: InstallCommandResult, { logger, note }) => {
      if (result.installations.length === 1) {
        const [installation] = result.installations;
        logger.success(`Installed workflow at ${installation.workflowPath}`);
        if (installation.promptPath !== undefined) {
          logger.message(`Prompt copied to ${installation.promptPath}`);
        }
        note(installation.promptContent, "Default prompt");
        if (!installation.ejected) {
          logger.message(
            `To customize the prompt, run: poe-code github-workflows install ${installation.name} --eject`
          );
        }
      } else {
        logger.success(`Installed ${result.installations.length} workflows.`);
        for (const installation of result.installations) {
          logger.message(installation.workflowPath);
        }
      }
      logger.message(`Shared variables written to ${result.variablesPath}`);
      logger.message(`Command reference written to ${result.readmePath}`);
    },
    json: (result: InstallCommandResult) => result
  }
});

const uninstallCommand = defineCommand({
  name: "uninstall",
  description: "Remove an installed automation workflow from the current repo.",
  positional: ["name"],
  params: S.Object({
    name: S.Enum(installableAutomations, {
      description: "Pick a GitHub workflow to uninstall",
      loadOptions: async () => {
        const automations = await discoverAutomations(await resolveBuiltInPromptsDir());
        return automations.map((a) => ({ label: a.label ?? formatLabel(a.name), value: a.name }));
      }
    })
  }),
  scope: ["cli"],
  handler: async ({ params }) => {
    const name = params.name;
    const workflowPath = path.join(resolveCwd(), ".github", "workflows", `poe-code-${name}.yml`);

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

const requireUserAllowCommand = defineCommand({
  name: "require-user-allow",
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

const prepareCommand = defineCommand({
  name: "prepare",
  description: "Install and configure the agent required by a workflow automation.",
  positional: ["name"],
  params: S.Object({
    name: S.String()
  }),
  scope: ["cli"],
  handler: async ({ params, env }) => {
    runPreflightChecks({ env, nodeVersion: process.version });
    const cwd = resolveCwd();
    const automation = await loadNamedAutomation(params.name, cwd);
    const agent = await setupWorkflowAgent(automation, cwd);
    return { agent, automation: automation.name };
  },
  render: {
    rich: (result: { agent: string; automation: string }, { logger }) => {
      logger.success(`Prepared agent "${result.agent}" for automation "${result.automation}".`);
    },
    json: (result: { agent: string; automation: string }) => result
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
  handler: async ({ params, env }) => {
    const cwd = resolveCwd();
    const automation = await loadNamedAutomation(params.name, cwd);
    const variables = await loadVariables(await resolveBuiltInAssetsDir(), projectGitHubWorkflowsDir(cwd));
    return {
      name: automation.name,
      prompt: renderPrompt(automation.prompt, { ...variables, ...buildTemplateContext(env) })
    };
  },
  render: {
    rich: (result: { name: string; prompt: string }, { logger }) => {
      logger.message(result.prompt);
    },
    json: (result: { name: string; prompt: string }) => result
  }
});

const variablesCommand = defineCommand({
  name: "variables",
  description: "List shared prompt variables and where each value comes from.",
  params: S.Object({}),
  scope: ["cli", "sdk"],
  handler: async () => {
    const cwd = resolveCwd();
    return (await loadVariableStatuses(await resolveBuiltInAssetsDir(), projectGitHubWorkflowsDir(cwd))).map(
      (status) => ({
        ...status,
        source: status.source === "built-in" ? status.source : path.relative(cwd, status.source)
      })
    );
  },
  render: {
    rich: (result: { name: string; source: string; status: string }[], { logger, renderTable, getTheme }) => {
      logger.message(
        renderTable({
          theme: getTheme(),
          columns: [
            { name: "name", title: "Name", alignment: "left", maxLen: 32 },
            { name: "status", title: "Status", alignment: "left", maxLen: 12 },
            { name: "source", title: "Source", alignment: "left", maxLen: 48 }
          ],
          rows: result
        })
      );
    },
    json: (result: { name: string; source: string; status: string }[]) => result
  }
});

export const ghGroup: Group = defineGroup({
  name: "github-workflows",
  aliases: ["gh"],
  description: "GitHub workflow automations.",
  children: [
    runCommandDef,
    prepareCommand,
    requireUserAllowCommand,
    requireCommentPrefixCommand,
    listCommand,
    installCommand,
    uninstallCommand,
    promptPreviewCommand,
    variablesCommand
  ],
  default: runCommandDef
});

async function loadNamedAutomation(name: string, cwd: string): Promise<AutomationDefinition> {
  const builtInPromptsDir = await resolveBuiltInPromptsDir();
  const automation = await loadAutomation(
    name,
    [...projectPromptDirs(cwd)].reverse().concat(builtInPromptsDir)
  );
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

async function readBuiltInWorkflowTemplate(
  name: string,
  variant: "caller" | "ejected",
  automationName: string = name,
  promptPath?: string
): Promise<string> {
  const templatePath = path.join(await resolveBuiltInWorkflowTemplatesDir(), `${name}.${variant}.yml`);
  try {
    const content = await readFile(templatePath, "utf8");
    const header =
      promptPath !== undefined
        ? `# Auto-generated by: poe-code github-workflows install ${name}\n# Edit ${path.relative(process.cwd(), promptPath)} to customize the prompt.\n`
        : `# Auto-generated by: poe-code github-workflows install ${name}\n`;
    const processedContent = content
      .replaceAll(` ${name}`, ` ${automationName}`)
      .replaceAll("__UPSTREAM_REPO__", UPSTREAM_REPO);
    return header + processedContent;
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

function projectPromptDirs(cwd: string): string[] {
  return [projectWorkflowDir(cwd)];
}

function projectWorkflowDir(cwd: string): string {
  return path.join(cwd, ".github", "workflows");
}

function projectGitHubWorkflowsDir(cwd: string): string {
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

async function resolveBuiltInAssetsDir(): Promise<string> {
  return path.dirname(await resolveBuiltInPromptsDir());
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
    "ISSUE_BODY",
    "COMMENT_AUTHOR",
    "COMMENT_BODY",
    "PR_NUMBER",
    "PR_TITLE",
    "PR_AUTHOR"
  ]) {
    const value = getOptionalEnvValue(env, key);
    if (value !== undefined) {
      values[key] = value;
    }
  }

  return values;
}

function buildTemplateContext(env: { get(key: string): string | undefined }): Record<string, unknown> {
  const repo = getOptionalEnvValue(env, "GITHUB_REPOSITORY");
  const issueNumber = getOptionalEnvValue(env, "ISSUE_NUMBER");
  const prNumber = getOptionalEnvValue(env, "PR_NUMBER");
  const url = buildUrl(repo, issueNumber, prNumber);

  return {
    ...(repo === undefined ? {} : { repo }),
    ...(url === undefined ? {} : { url }),
    issue: pruneUndefined({
      number: issueNumber,
      title: getOptionalEnvValue(env, "ISSUE_TITLE"),
      body: getOptionalEnvValue(env, "ISSUE_BODY")
    }),
    comment: pruneUndefined({
      author: getOptionalEnvValue(env, "COMMENT_AUTHOR"),
      body: getOptionalEnvValue(env, "COMMENT_BODY")
    }),
    pr: pruneUndefined({
      number: prNumber,
      title: getOptionalEnvValue(env, "PR_TITLE"),
      author: getOptionalEnvValue(env, "PR_AUTHOR")
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

  if (prNumber !== undefined) {
    return `https://github.com/${repo}/pull/${prNumber}`;
  }

  if (issueNumber !== undefined) {
    return `https://github.com/${repo}/issues/${issueNumber}`;
  }

  return undefined;
}

function getOptionalEnvValue(
  env: { get(key: string): string | undefined },
  key: string
): string | undefined {
  const value = env.get(key);
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
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
  return Mustache.render(template, view);
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

function addPromptHeader(content: string, name: string): string {
  const comment = `# Installed by: poe-code github-workflows install ${name}\n# Edit this file to customize the automation prompt and configuration.\n`;
  if (content.startsWith("---\n")) {
    return "---\n" + comment + content.slice(4);
  }
  return content;
}

async function installAutomation(
  name: string,
  cwd: string,
  isEject: boolean
): Promise<InstalledAutomationResult> {
  const variant = isEject ? "ejected" : "caller";
  const localAutomationName = isEject ? `poe-code-${name}` : name;
  const promptPath = isEject ? path.join(projectWorkflowDir(cwd), `${localAutomationName}.md`) : undefined;
  const [workflowTemplate, rawPrompt] = await Promise.all([
    readBuiltInWorkflowTemplate(name, variant, localAutomationName, promptPath),
    readBuiltInPromptFile(name)
  ]);
  const workflowPath = path.join(cwd, ".github", "workflows", `poe-code-${name}.yml`);

  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, workflowTemplate, "utf8");

  if (promptPath !== undefined) {
    await mkdir(path.dirname(promptPath), { recursive: true });
    await writeFile(promptPath, addPromptHeader(rawPrompt, name), "utf8");
  }

  return {
    name,
    workflowPath,
    promptPath,
    ejected: isEject,
    promptContent: rawPrompt
  };
}

async function ensureProjectSupportFiles(
  cwd: string,
  builtInVariables: Record<string, string>
): Promise<{ readmePath: string; variablesPath: string }> {
  const projectDir = projectGitHubWorkflowsDir(cwd);
  const variablesPath = path.join(projectDir, "variables.yaml");
  const readmePath = path.join(projectDir, "README.md");

  await mkdir(projectDir, { recursive: true });
  await writeFile(
    variablesPath,
    generateProjectVariablesFile(builtInVariables, await readOptionalFile(variablesPath)),
    "utf8"
  );
  await writeFile(readmePath, renderProjectReadme(), "utf8");

  return { readmePath, variablesPath };
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
}

function renderProjectReadme(): string {
  return [
    "# GitHub Workflows",
    "",
    "## Commands",
    "",
    "| Command | Description |",
    "|---------|-------------|",
    "| `poe-code github-workflows list` | List available automations |",
    "| `poe-code github-workflows install <name>` | Install a workflow (use `--eject` to customize the prompt) |",
    "| `poe-code github-workflows uninstall <name>` | Remove an installed workflow |",
    "| `poe-code github-workflows prompt-preview <name>` | Preview the rendered prompt with variables resolved |",
    "| `poe-code github-workflows run <name>` | Run an automation locally |",
    "| `poe-code github-workflows variables` | List shared prompt variables and where each value comes from |",
    "",
    "## Customization",
    "",
    "Edit `variables.yaml` to override shared prompt variables.",
    'Uncomment a variable and change its value. Set to `""` to disable.',
    ""
  ].join("\n");
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
