import path from "node:path";
import { defineCommand, defineGroup, S, UserError } from "toolcraft";
import { resolveOutputFormat } from "toolcraft-design";
import { runInitCli } from "./init.js";
import { runCheckCli } from "./check.js";
import { runLintCli } from "./lint.js";
import { loadSourceConfig } from "../source/config.js";
import { openSource } from "../source/open.js";
import { listEvals } from "../source/registry.js";
import { runMatrix } from "../run/matrix.js";
import { compareResultCollections } from "../aggregate.js";
import { listRuns, loadLatestMatrix, loadRunResult } from "../report/load.js";
import {
  renderComparisonMarkdown,
  renderMatrixMarkdown,
  renderRunsMarkdown
} from "../report/render-md.js";
import {
  renderComparisonTable,
  renderMatrixTable,
  renderRunsTable
} from "../report/render-table.js";
import type {
  AggregatedCell,
  EvalMatrixOptions,
  EvalRunResult,
  JudgeOverrideSpec,
  SourceConfig
} from "../types.js";

type ReportFormat = "json" | "md" | "table";
type EvalRunOutput = { dryRun: true; message: string } | { dryRun: false; runs: EvalRunResult[] };

const initParams = S.Object({
  name: S.String({ description: "Eval folder name" }),
  cwd: S.Optional(
    S.String({
      description: "Eval source directory",
      short: "C"
    })
  ),
  kind: S.Enum(["plan", "pipeline", "superintendent", "experiment"] as const, {
    description: "Plan kind",
    default: "plan"
  }),
  targetRepo: S.Optional(S.String({ description: "Target git repository" })),
  targetRef: S.Optional(S.String({ description: "Target git ref" })),
  dryRun: S.Optional(S.Boolean({
    description: "Preview scaffold creation without writing files",
    scope: ["cli", "sdk"],
    global: true
  }))
});

const checkParams = S.Object({
  evalId: S.Optional(S.String({ description: "Eval id to check" })),
  cwd: S.Optional(
    S.String({
      description: "Eval source directory",
      short: "C"
    })
  ),
  dryRun: S.Optional(S.Boolean({
    description: "Preview oracle verification without cloning or executing tests",
    scope: ["cli", "sdk"],
    global: true
  }))
});

const lintParams = S.Object({
  evalId: S.Optional(S.String({ description: "Eval id to lint" })),
  cwd: S.Optional(
    S.String({
      description: "Eval source directory",
      short: "C"
    })
  )
});

const runParams = S.Object({
  agent: S.Array(S.String(), {
    description: "Agent ids to evaluate, comma-separated or repeated",
    minItems: 1
  }),
  model: S.Array(S.String(), {
    description: "Model ids to evaluate, comma-separated or repeated",
    minItems: 1
  }),
  cwd: S.Optional(
    S.String({
      description: "Eval source directory",
      short: "C"
    })
  ),
  eval: S.Optional(
    S.Array(S.String(), {
      description: "Eval ids to run, comma-separated or repeated",
      minItems: 1
    })
  ),
  repeats: S.Number({
    description: "Number of repeats per eval/agent/model cell",
    default: 3,
    minimum: 1,
    jsonType: "integer"
  }),
  judge: S.Optional(S.String({ description: "Judge agent override" })),
  noJudge: S.Optional(S.Boolean({ description: "Disable judge scoring" })),
  verify: S.Boolean({
    description: "Eval oracle verification",
    default: true
  }),
  out: S.Optional(S.String({ description: "Output directory" })),
  dryRun: S.Optional(S.Boolean({
    description: "Preview the eval run without executing agents or writing artifacts",
    scope: ["cli", "sdk"],
    global: true
  }))
});

const reportParams = S.Object({
  runId: S.Optional(S.String({ description: "Run id to report" })),
  cwd: S.Optional(
    S.String({
      description: "Eval source directory",
      short: "C"
    })
  ),
  format: S.Enum(["json", "md", "table"] as const, {
    description: "Report format",
    default: "table"
  }),
  allRuns: S.Optional(S.Boolean({ description: "Report every run result" })),
  out: S.Optional(S.String({ description: "Runs output directory" })),
  baselineOut: S.Optional(S.String({ description: "Local baseline runs output directory" }))
});

export const evalRunCommand = defineCommand({
  name: "run",
  description: "Run an eval matrix.",
  params: runParams,
  scope: ["cli", "sdk"],
  handler: async ({ params }) => {
    if (params.dryRun === true) {
      const evalIds = params.eval?.join(", ") ?? "configured evals";
      return {
        dryRun: true,
        message: `Dry run: would run eval matrix for ${evalIds} with ${params.agent.join(", ")} on ${params.model.join(", ")}.`
      } satisfies EvalRunOutput;
    }
    const sourceDir = path.resolve(params.cwd ?? process.cwd());
    const source = await openSource(sourceDir);
    const config = await loadSourceConfig(source);
    const evalIds = params.eval ?? [...(await listEvals(source))];
    const options: EvalMatrixOptions = {
      sourceDir: source.rootDir,
      evalIds,
      agents: params.agent,
      models: params.model,
      repeats: params.repeats,
      outDir: resolveOutputDirectory(source.rootDir, params.out ?? config.out),
      cloneCacheDir: config.clone_cache_dir,
      verifyOracle: params.verify,
      judge: resolveJudgeOption(readNoJudge(params), readJudgeAgent(params.judge), config)
    };
    const runs: EvalRunResult[] = [];

    for await (const result of runMatrix(options)) {
      runs.push(result);
      if (resolveOutputFormat() === "terminal") {
        process.stdout.write(`${renderRunsTable(runs)}\n`);
      }
    }

    return { dryRun: false, runs } satisfies EvalRunOutput;
  },
  render: {
    rich: (result: EvalRunOutput, { logger }) => {
      if (result.dryRun) logger.message(result.message);
    },
    markdown: (result: EvalRunOutput) =>
      result.dryRun ? result.message : renderRunsMarkdown(result.runs),
    json: (result: EvalRunOutput) => result
  }
});

export const evalReportCommand = defineCommand({
  name: "report",
  description: "Render eval run reports.",
  positional: ["runId"],
  params: reportParams,
  scope: ["cli", "sdk"],
  handler: async ({ params }) => {
    if (params.runId !== undefined && params.allRuns === true) {
      throw new UserError("Use either run-id or --all-runs, not both.");
    }

    const sourceDir = path.resolve(params.cwd ?? process.cwd());
    const source = await openSource(sourceDir);
    const config = await loadSourceConfig(source);
    const outDir = resolveOutputDirectory(source.rootDir, params.out ?? config.out);
    const baselineOutDir =
      params.baselineOut === undefined
        ? undefined
        : resolveOutputDirectory(source.rootDir, params.baselineOut);

    if (params.runId !== undefined) {
      const run = await loadRunResult(params.runId, outDir);
      if (baselineOutDir !== undefined) {
        const comparison = compareResultCollections(await loadCollection(baselineOutDir), [run]);
        printRunsReport([run], params.format, comparison);
      } else {
        printRunsReport([run], params.format);
      }
      return null;
    }

    if (params.allRuns === true) {
      const runIds = await listRuns(outDir);
      const runs = await Promise.all(runIds.map((runId) => loadRunResult(runId, outDir)));
      if (baselineOutDir !== undefined) {
        const comparison = compareResultCollections(await loadCollection(baselineOutDir), runs);
        printRunsReport(runs, params.format, comparison);
      } else {
        printRunsReport(runs, params.format);
      }
      return null;
    }

    const matrix = await loadLatestMatrix(outDir);
    const runs =
      params.format === "md" || baselineOutDir !== undefined
        ? await loadMatrixRuns(matrix.cells, outDir)
        : [];
    if (baselineOutDir !== undefined) {
      const baselineMatrix = await loadLatestMatrix(baselineOutDir);
      const comparison = compareResultCollections(
        await loadMatrixRuns(baselineMatrix.cells, baselineOutDir),
        runs
      );
      printMatrixReport(matrix.cells, params.format, runs, comparison);
    } else {
      printMatrixReport(matrix.cells, params.format, runs);
    }
    return null;
  },
  render: {
    rich: () => {},
    markdown: () => "",
    json: () => undefined
  }
});

export const evalInitCommand = defineCommand({
  name: "init",
  description: "Create a minimal eval folder.",
  positional: ["name"],
  params: initParams,
  scope: ["cli", "sdk"],
  handler: async ({ params }) => {
    if (params.dryRun === true) {
      process.stdout.write(`Dry run: would create ${params.kind} eval scaffold ${params.name}.\n`);
      return null;
    }
    const exitCode = await runInitCli({
      name: params.name,
      sourceDir: params.cwd,
      kind: params.kind,
      targetRepo: params.targetRepo,
      targetRef: params.targetRef
    });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
    return null;
  },
  render: {
    rich: () => {},
    markdown: () => "",
    json: () => undefined
  }
});

export const evalCheckCommand = defineCommand({
  name: "check",
  description: "Verify an eval oracle against its solution.",
  positional: ["evalId"],
  params: checkParams,
  scope: ["cli", "sdk"],
  handler: async ({ params }) => {
    if (params.dryRun === true) {
      process.stdout.write(`Dry run: would verify eval oracle ${params.evalId ?? "the selected eval"}.\n`);
      return null;
    }
    const exitCode = await runCheckCli({
      evalId: params.evalId,
      sourceDir: params.cwd
    });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
    return null;
  },
  render: {
    rich: () => {},
    markdown: () => "",
    json: () => undefined
  }
});

export const evalLintCommand = defineCommand({
  name: "lint",
  description: "Lint eval metadata without cloning targets.",
  positional: ["evalId"],
  params: lintParams,
  scope: ["cli", "sdk"],
  handler: async ({ params }) => {
    const exitCode = await runLintCli({
      evalId: params.evalId,
      sourceDir: params.cwd
    });
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
    return null;
  },
  render: {
    rich: () => {},
    markdown: () => "",
    json: () => undefined
  }
});

const children = [
  evalRunCommand,
  evalReportCommand,
  evalInitCommand,
  evalCheckCommand,
  evalLintCommand
] as const;

export const evalGroup = defineGroup({
  name: "eval",
  description: "Run and report agent eval matrices.",
  scope: ["cli", "sdk"],
  children
});

function resolveOutputDirectory(sourceDir: string, outDir: string): string {
  return path.isAbsolute(outDir) ? outDir : path.resolve(sourceDir, outDir);
}

function readNoJudge(params: { judge?: string; noJudge?: boolean }): boolean {
  return params.noJudge === true || (params.judge as unknown) === true;
}

function readJudgeAgent(value: string | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolveJudgeOption(
  disabled: boolean,
  judgeAgent: string | undefined,
  config: SourceConfig
): EvalMatrixOptions["judge"] {
  if (disabled) {
    return "off";
  }

  const override: JudgeOverrideSpec = {
    agent: judgeAgent ?? config.judge.agent,
    model: config.judge.model
  };
  return override;
}

function printRunsReport(
  runs: readonly EvalRunResult[],
  format: ReportFormat,
  comparison?: ReturnType<typeof compareResultCollections>
): void {
  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify(comparison === undefined ? runs : { runs, comparison }, null, 2)}\n`
    );
    return;
  }

  process.stdout.write(`${format === "md" ? renderRunsMarkdown(runs) : renderRunsTable(runs)}\n`);
  if (comparison !== undefined) {
    printComparison(comparison, format);
  }
}

function printMatrixReport(
  cells: readonly AggregatedCell[],
  format: ReportFormat,
  runs: readonly EvalRunResult[] = [],
  comparison?: ReturnType<typeof compareResultCollections>
): void {
  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify(comparison === undefined ? cells : { cells, comparison }, null, 2)}\n`
    );
    return;
  }

  process.stdout.write(
    `${format === "md" ? renderMatrixMarkdown(cells, runs) : renderMatrixTable(cells)}\n`
  );
  if (comparison !== undefined) {
    printComparison(comparison, format);
  }
}

function printComparison(
  comparison: ReturnType<typeof compareResultCollections>,
  format: ReportFormat
): void {
  process.stdout.write(
    `\n${format === "md" ? renderComparisonMarkdown(comparison) : renderComparisonTable(comparison)}\n`
  );
}

async function loadCollection(outDir: string): Promise<EvalRunResult[]> {
  const runIds = await listRuns(outDir);
  return Promise.all(runIds.map((runId) => loadRunResult(runId, outDir)));
}

async function loadMatrixRuns(
  cells: readonly AggregatedCell[],
  outDir: string
): Promise<EvalRunResult[]> {
  const runs: EvalRunResult[] = [];
  for (const runId of cells.flatMap((cell) => cell.runIds)) {
    try {
      runs.push(await loadRunResult(runId, outDir));
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Run result not found for ")) {
        throw error;
      }
    }
  }
  return runs;
}
