import path from "node:path";
import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import {
  discoverHarnesses,
  listBuiltinTemplates,
  runHarnessPair,
  type HarnessImportMeta,
  type HarnessPair
} from "@poe-code/agent-harness";
import {
  makeAgentModule,
  makeFailModule,
  makeGitModule,
  makeHarnessModule,
  makeLogModule,
  makeMetricModule
} from "@poe-code/agent-script";
import {
  cancel,
  getTheme,
  isCancel,
  promptText,
  renderTable,
  select,
  withSpinner
} from "@poe-code/design-system";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { spawn as sdkSpawn } from "../../sdk/spawn.js";

type HarnessRunOptions = {
  yes?: boolean;
};

type HarnessNewOptions = {
  dir?: string;
  yes?: boolean;
};

type ModuleExports = ReadonlyMap<string, unknown> | Record<string, unknown>;
type ModuleRegistry = ReadonlyMap<string, ModuleExports> | Record<string, ModuleExports>;

type HarnessPairWithLocation = HarnessPair & {
  dir: string;
  mdMtimeMs: number;
};

export function registerHarnessCommand(program: Command, container: CliContainer): void {
  const harness = program.command("harness").description("Run and manage agent harness pairs.");

  harness
    .command("run")
    .description("Run a harness pair.")
    .argument("[md-path]", "Path to the harness .md file")
    .option("-y, --yes", "Accept defaults without prompting.")
    .action(async (mdPath: string | undefined, options: HarnessRunOptions) => {
      await executeHarnessRun(program, container, mdPath, options);
    });

  harness
    .command("new")
    .description("Scaffold a harness pair from a built-in template.")
    .argument("<kind>", "Built-in template kind")
    .argument("<basename>", "New harness basename")
    .option("--dir <path>", "Output directory for the harness pair")
    .option("-y, --yes", "Accept defaults without prompting.")
    .action(async (kind: string, basename: string, options: HarnessNewOptions) => {
      await executeHarnessNew(program, container, kind, basename, options);
    });

  harness
    .command("list")
    .description("List discovered harness pairs.")
    .action(async () => {
      await executeHarnessList(program, container);
    });
}

async function executeHarnessRun(
  program: Command,
  container: CliContainer,
  mdPath: string | undefined,
  options: HarnessRunOptions
): Promise<void> {
  const flags = resolveHarnessFlags(program, options.yes);
  const resources = createExecutionResources(container, flags, "harness:run");
  const selectedPath = mdPath
    ? path.resolve(container.env.cwd, mdPath)
    : (await resolveDiscoveredHarness(container, flags.assumeYes)).mdPath;

  resources.logger.intro("harness run");

  const result = await withSpinner({
    message: `Running ${formatDisplayPath(container, selectedPath)}`,
    fn: () =>
      runHarnessPair(selectedPath, {
        modulesFor: (frontmatter, meta) => createHarnessModules(container, frontmatter, meta)
      }),
    stopMessage: () => `Ran ${formatDisplayPath(container, selectedPath)}`
  });

  resources.logger.info(JSON.stringify(result, null, 2));
}

async function executeHarnessNew(
  program: Command,
  container: CliContainer,
  kind: string,
  basename: string,
  options: HarnessNewOptions
): Promise<void> {
  const flags = resolveHarnessFlags(program, options.yes);
  const resources = createExecutionResources(container, flags, "harness:new");
  const template = listBuiltinTemplates().find((entry) => entry.kind === kind);

  resources.logger.intro("harness new");

  if (!template) {
    throw new ValidationError(`Unknown harness template "${kind}".`);
  }

  const defaultDir = path.join(".poe-code", "harnesses", basename);
  const outputDir = options.dir ?? (await resolveOutputDir(defaultDir, flags.assumeYes));
  const resolvedDir = path.resolve(container.env.cwd, outputDir);
  const mdPath = path.join(resolvedDir, `${basename}.md`);
  const ajsPath = path.join(resolvedDir, `${basename}.ajs`);

  await assertFilesDoNotExist(container, [mdPath, ajsPath]);

  if (flags.dryRun) {
    resources.logger.dryRun(`Would create ${formatDisplayPath(container, mdPath)}`);
    resources.logger.dryRun(`Would create ${formatDisplayPath(container, ajsPath)}`);
    return;
  }

  const [mdSource, ajsSource] = await Promise.all([
    readFile(template.mdPath, "utf8"),
    readFile(template.ajsPath, "utf8")
  ]);

  await container.fs.mkdir(resolvedDir, { recursive: true });
  await Promise.all([
    container.fs.writeFile(mdPath, mdSource, { encoding: "utf8" }),
    container.fs.writeFile(ajsPath, ajsSource, { encoding: "utf8" })
  ]);

  resources.context.complete({
    success: `Created harness pair at ${formatDisplayPath(container, resolvedDir)}`,
    dry: `Would create harness pair at ${formatDisplayPath(container, resolvedDir)}`
  });
  resources.context.finalize();
}

async function executeHarnessList(program: Command, container: CliContainer): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "harness:list");

  resources.logger.intro("harness list");

  const pairs = await discoverProjectThenUserHarnesses(container);
  if (pairs.length === 0) {
    resources.logger.info("No harness pairs found.");
    return;
  }

  const theme = getTheme();
  const rows = pairs.map((pair) => ({
    Basename: theme.accent(pair.basename),
    Dir: formatDisplayPath(container, pair.dir),
    "MD mtime": new Date(pair.mdMtimeMs).toISOString()
  }));

  resources.logger.info(
    renderTable({
      theme,
      columns: [
        { name: "Basename", title: "Basename", alignment: "left", maxLen: 28 },
        { name: "Dir", title: "Dir", alignment: "left", maxLen: 64 },
        { name: "MD mtime", title: ".md mtime", alignment: "left", maxLen: 24 }
      ],
      rows
    })
  );
}

function resolveHarnessFlags(
  program: Command,
  commandYes: boolean | undefined
): ReturnType<typeof resolveCommandFlags> {
  const flags = resolveCommandFlags(program);
  return {
    ...flags,
    assumeYes: flags.assumeYes || Boolean(commandYes)
  };
}

async function resolveDiscoveredHarness(
  container: CliContainer,
  assumeYes: boolean
): Promise<HarnessPairWithLocation> {
  const pairs = await discoverProjectThenUserHarnesses(container);

  if (pairs.length === 0) {
    throw new ValidationError("No harness pairs found.");
  }

  if (pairs.length === 1) {
    return pairs[0]!;
  }

  if (assumeYes) {
    throw new ValidationError("Multiple harness pairs found; ambiguous, pass a path.");
  }

  const selected = await select({
    message: "Select harness",
    options: pairs.map((pair) => ({
      label: `${pair.basename} (${formatDisplayPath(container, pair.dir)})`,
      value: pair.mdPath
    }))
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    throw new ValidationError("Operation cancelled.");
  }

  const pair = pairs.find((entry) => entry.mdPath === selected);
  if (!pair) {
    throw new ValidationError("Selected harness was not found.");
  }
  return pair;
}

async function discoverProjectThenUserHarnesses(
  container: CliContainer
): Promise<HarnessPairWithLocation[]> {
  const roots = [
    path.join(container.env.cwd, ".poe-code", "harnesses"),
    path.join(container.env.homeDir, ".poe-code", "harnesses")
  ];
  const discovered: HarnessPairWithLocation[] = [];

  for (const root of roots) {
    const pairs = await discoverHarnesses(
      root,
      container.fs as Parameters<typeof discoverHarnesses>[1]
    );
    for (const pair of pairs) {
      const stat = await container.fs.stat(pair.mdPath);
      discovered.push({
        ...pair,
        dir: path.dirname(pair.mdPath),
        mdMtimeMs: stat.mtimeMs
      });
    }
  }

  return discovered;
}

async function resolveOutputDir(defaultDir: string, assumeYes: boolean): Promise<string> {
  if (assumeYes) {
    return defaultDir;
  }

  const answer = await promptText({
    message: "Harness directory",
    initialValue: defaultDir
  });

  if (isCancel(answer)) {
    cancel("Operation cancelled.");
    throw new ValidationError("Operation cancelled.");
  }

  const dir = answer.trim();
  if (dir.length === 0) {
    throw new ValidationError("Harness directory is required.");
  }
  return dir;
}

async function assertFilesDoNotExist(container: CliContainer, filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    if (await pathExists(container, filePath)) {
      throw new ValidationError(
        `Refusing to overwrite existing file: ${formatDisplayPath(container, filePath)}`
      );
    }
  }
}

async function pathExists(container: CliContainer, filePath: string): Promise<boolean> {
  try {
    await container.fs.stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function createHarnessModules(
  container: CliContainer,
  frontmatter: Record<string, unknown>,
  meta: HarnessImportMeta
): ModuleRegistry {
  const harnessMeta = {
    kind: meta.kind,
    version: meta.version,
    filepath: meta.filename
  };
  const agent = makeAgentModule(async (input) => {
    const { result } = sdkSpawn(input.agent, {
      prompt: input.prompt,
      cwd: input.cwd ?? meta.dirname,
      model: input.model,
      mode: input.mode,
      mcpServers: input.mcp,
      signal: undefined
    });
    const resolved = await result;
    return {
      exitCode: resolved.exitCode,
      stdout: resolved.stdout,
      stderr: resolved.stderr,
      summary: resolved.stdout || resolved.stderr,
      durationMs: 0
    };
  });
  const fail = makeFailModule().default;
  const git = makeGitModule(meta.dirname);
  const harness = makeHarnessModule(frontmatter, harnessMeta);
  const log = makeLogModule();
  const metric = makeMetricModule(async (scriptName) => {
    const result = await container.commandRunner("npm", ["run", scriptName], {
      cwd: meta.dirname
    });
    if (result.exitCode !== 0) {
      throw new Error(`Metric script "${scriptName}" failed with exit code ${result.exitCode}.`);
    }
    return result.stdout;
  });

  return {
    agent: toModuleExports(agent),
    fail: toModuleExports(new Map([["default", fail]])),
    git: toModuleExports(git),
    harness: toModuleExports(harness),
    log: toModuleExports(log),
    metric: toModuleExports(metric)
  };
}

function toModuleExports(moduleExports: ModuleExports): ModuleExports {
  if (moduleExports instanceof Map) {
    return moduleExports;
  }
  return new Map(Object.entries(moduleExports));
}

function formatDisplayPath(container: CliContainer, filePath: string): string {
  const relative = path.relative(container.env.cwd, filePath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : filePath.replace(container.env.homeDir, "~");
}
