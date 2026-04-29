import path from "node:path";
import type { Command } from "commander";
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
  splitFrontmatter,
  type Diagnostic
} from "@poe-code/agent-script";
import type { CliContainer } from "../container.js";
import { throwCommandNotFound } from "../command-not-found.js";

export function registerAgentScriptCommand(program: Command, container: CliContainer): void {
  const agentScript = program
    .command("agent-script")
    .description("Lint agent script files.")
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
