import path from "node:path";
import type { Command } from "commander";
import { buildSpawnArgs } from "@poe-code/agent-spawn";
import {
  extractBlock,
  lint,
  makeAgentModule,
  makeEnvModule,
  makeFailModule,
  makeGitModule,
  makeHarnessModule,
  makeLogModule,
  makeMcpModule,
  makeMetricModule,
  makeTimeModule,
  runHarness,
  splitFrontmatter,
  type Diagnostic
} from "@poe-code/agent-script";
import { McpClient, StdioTransport } from "tiny-mcp-client";
import type { CliContainer } from "../container.js";
import { throwCommandNotFound } from "../command-not-found.js";

type AgentScriptRunDependencies = {
  runHarness: typeof runHarness;
};

type RunModulesFor = Parameters<typeof runHarness>[1]["modulesFor"];
type RunModules = ReturnType<RunModulesFor>;

const defaultAgentScriptRunDependencies: AgentScriptRunDependencies = {
  runHarness
};

export function registerAgentScriptCommand(
  program: Command,
  container: CliContainer,
  dependencies: AgentScriptRunDependencies = defaultAgentScriptRunDependencies
): void {
  const agentScript = program
    .command("agent-script")
    .description("Lint or run agent script files.")
    .allowExcessArguments()
    .addHelpCommand(false)
    .action(function (this: Command) {
      if (this.args.length > 0) {
        throwCommandNotFound({
          container,
          scope: "cli",
          unknownCommand: this.args.at(0) ?? "",
          helpArgs: ["agent-script", "--help"],
          moduleUrl: import.meta.url
        });
      }

      this.help();
    });

  agentScript
    .command("lint")
    .description("Lint an agent script file and print compiler-style diagnostics.")
    .argument("<path>", "Path to a .ajs or markdown agent script file")
    .action(async (filepath: string) => {
      const diagnostics = await lintAgentScript(container, filepath);
      writeDiagnostics(diagnostics);
      process.exitCode = diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 1 : 0;
    });

  agentScript
    .command("run")
    .description("Run an agent script file with the default runtime module bundle.")
    .argument("<path>", "Path to a .ajs or markdown agent script file")
    .option("--reset", "Discard the existing snapshot before running")
    .option("--snapshot <path>", "Override the snapshot path")
    .option("--no-snapshot", "Disable checkpointing")
    .action(async function (this: Command, filepath: string) {
      const options = this.opts<{
        reset?: boolean;
        snapshot?: string | boolean;
      }>();

      await runAgentScript(container, filepath, {
        reset: options.reset === true,
        snapshotPath: typeof options.snapshot === "string" ? options.snapshot : undefined,
        snapshotEnabled: options.snapshot !== false
      }, dependencies);
    });
}

async function lintAgentScript(container: CliContainer, filepath: string): Promise<Diagnostic[]> {
  const resolvedPath = path.resolve(container.env.cwd, filepath);
  const rawSource = stripByteOrderMark(await container.fs.readFile(resolvedPath, "utf8"));
  const { executableSource, frontmatter, isRawScript } = loadExecutableSource(resolvedPath, rawSource);

  return lint(executableSource, {
    filename: resolvedPath,
    modules: createLintModules(frontmatter, {
      filepath: resolvedPath,
      kind: frontmatter.kind,
      version: frontmatter.version
    }, isRawScript, container.env.cwd)
  });
}

function createLintModules(
  frontmatter: Record<string, unknown>,
  meta: {
    filepath: string;
    kind: unknown;
    version: unknown;
  },
  isRawScript: boolean,
  cwd: string
) {
  const modules = {
    agent: listModuleExports(
      makeAgentModule(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        summary: "",
        durationMs: 0
      }))
    ),
    env: listModuleExports(makeEnvModule([])),
    fail: listModuleExports(makeFailModule()),
    git: listModuleExports(makeGitModule(cwd)),
    harness: listModuleExports(makeHarnessModule(frontmatter, meta)),
    log: listModuleExports(makeLogModule(() => {})),
    mcp: listModuleExports(
      makeMcpModule(async () => ({
        listTools: async () => ({ tools: [] }),
        callTool: async () => ({})
      }))
    ),
    metric: listModuleExports(makeMetricModule(async () => "0")),
    time: listModuleExports(makeTimeModule())
  };

  if (isRawScript) {
    const { harness: ignoredHarness, ...rawModules } = modules;
    void ignoredHarness;
    return rawModules;
  }

  return modules;
}

function listModuleExports(moduleExports: Record<string, unknown>): string[] {
  return Object.keys(moduleExports).sort((left, right) => left.localeCompare(right));
}

function loadExecutableSource(filepath: string, source: string): {
  executableSource: string;
  frontmatter: Record<string, unknown>;
  isRawScript: boolean;
} {
  if (path.extname(filepath) === ".ajs") {
    return {
      executableSource: source,
      frontmatter: {},
      isRawScript: true
    };
  }

  const { frontmatter, body } = splitFrontmatter(source);
  const { source: executableBlock, lineOffset } = extractBlock(body);
  const absoluteLineOffset = countLineBreaks(source.slice(0, source.length - body.length)) + lineOffset;

  return {
    executableSource: createLineOffsetSource(executableBlock, absoluteLineOffset),
    frontmatter,
    isRawScript: false
  };
}

function writeDiagnostics(diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    process.stdout.write(formatDiagnostic(diagnostic));
  }
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${diagnostic.filename}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code} ${diagnostic.message}\n`;
}

function stripByteOrderMark(source: string): string {
  return source.startsWith("\uFEFF") ? source.slice(1) : source;
}

function countLineBreaks(source: string): number {
  let count = 0;

  for (const character of source) {
    if (character === "\n") {
      count += 1;
    }
  }

  return count;
}

function createLineOffsetSource(source: string, lineOffset: number): string {
  return `${"\n".repeat(Math.max(lineOffset, 0))}${source}`;
}

async function runAgentScript(
  container: CliContainer,
  filepath: string,
  options: {
    reset: boolean;
    snapshotEnabled: boolean;
    snapshotPath?: string;
  },
  dependencies: AgentScriptRunDependencies
): Promise<void> {
  const resolvedPath = path.resolve(container.env.cwd, filepath);
  const resolvedSnapshotPath = resolveAgentScriptSnapshotPath(container.env.cwd, resolvedPath, options.snapshotPath);

  if (options.reset) {
    await deleteIfExists(container, resolvedSnapshotPath);
  }

  try {
    const result = await dependencies.runHarness(resolvedPath, {
      modulesFor: (frontmatter, meta) => createRunModules(container, frontmatter, meta),
      snapshotPath: options.snapshotEnabled ? resolvedSnapshotPath : undefined
    });

    if (isFailedRunResult(result)) {
      writeRunError(resolvedPath, result.error);
      process.exitCode = 1;
      return;
    }

    if ("returnValue" in result && result.returnValue !== undefined) {
      process.stdout.write(`${formatRunReturnValue(result.returnValue)}\n`);
    }

    process.exitCode = 0;
  } catch (error) {
    if (hasDiagnostics(error)) {
      writeDiagnostics(error.diagnostics);
    } else {
      process.stderr.write(`${formatRunThrownError(error)}\n`);
    }

    process.exitCode = 1;
  }
}

function createRunModules(
  container: CliContainer,
  frontmatter: Record<string, unknown>,
  meta: {
    filepath: string;
    kind: unknown;
    version: unknown;
  }
): RunModules {
  return {
    agent: makeAgentModule(async (input) => {
      const startedAt = Date.now();
      const spawnArgs = buildSpawnArgs(input.agent, {
        prompt: input.prompt,
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.mode === undefined ? {} : { mode: input.mode }),
        ...(input.mcp === undefined ? {} : { mcpServers: input.mcp })
      });
      const result = await container.commandRunner(spawnArgs.binaryName, spawnArgs.args, {
        cwd: input.cwd ?? container.env.cwd,
        ...(spawnArgs.env === undefined ? {} : { env: spawnArgs.env })
      });

      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        summary: "",
        durationMs: Date.now() - startedAt
      };
    }),
    env: makeEnvModule([]),
    fail: makeFailModule(),
    git: makeGitModule(container.env.cwd),
    harness: makeHarnessModule(frontmatter, meta),
    log: makeLogModule(),
    mcp: makeMcpModule(async (server) => {
      const client = new McpClient({
        clientInfo: {
          name: "poe-code-agent-script",
          version: "0.0.0"
        }
      });

      await client.connect(
        new StdioTransport({
          command: server.command,
          ...(server.args === undefined ? {} : { args: server.args }),
          ...(server.env === undefined ? {} : { env: server.env })
        })
      );

      return {
        listTools: async () => client.listTools(),
        callTool: async (params) =>
          client.callTool({
            name: params.name,
            ...(params.arguments === undefined ? {} : { arguments: params.arguments as Record<string, unknown> })
          })
      };
    }),
    metric: makeMetricModule(async (scriptName) => {
      const result = await container.commandRunner("npm", ["run", "--silent", scriptName], {
        cwd: container.env.cwd
      });

      if (result.exitCode !== 0) {
        const stderr = result.stderr.trim();
        throw new Error(
          stderr.length > 0
            ? `npm run --silent ${scriptName} failed with exit code ${result.exitCode}: ${stderr}`
            : `npm run --silent ${scriptName} failed with exit code ${result.exitCode}.`
        );
      }

      return result.stdout;
    }),
    time: makeTimeModule()
  } as RunModules;
}

function resolveAgentScriptSnapshotPath(cwd: string, filepath: string, snapshotPath: string | undefined): string {
  if (snapshotPath !== undefined) {
    return path.resolve(cwd, snapshotPath);
  }

  return `${filepath}.snapshot.json`;
}

async function deleteIfExists(container: CliContainer, filepath: string): Promise<void> {
  try {
    if (typeof container.fs.rm === "function") {
      await container.fs.rm(filepath, { force: true });
      return;
    }

    await container.fs.unlink(filepath);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function formatRunReturnValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function writeRunError(
  filepath: string,
  error: {
    message: string;
    span: {
      start: {
        line: number;
        column: number;
      };
    };
  }
): void {
  process.stderr.write(`${filepath}:${error.span.start.line}:${error.span.start.column} ${error.message}\n`);
}

function formatRunThrownError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function hasDiagnostics(error: unknown): error is { diagnostics: readonly Diagnostic[] } {
  return typeof error === "object" && error !== null && Array.isArray((error as { diagnostics?: unknown }).diagnostics);
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function isFailedRunResult(
  result: Awaited<ReturnType<typeof runHarness>>
): result is Awaited<ReturnType<typeof runHarness>> & {
  ok: false;
  error: {
    message: string;
    span: {
      start: {
        line: number;
        column: number;
      };
    };
  };
} {
  return result.ok === false;
}
