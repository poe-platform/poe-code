import path from "node:path";
import { defineCommand, defineGroup, S, UserError } from "toolcraft";
import { runInitCli } from "./init.js";
import { runCheckCli } from "./check.js";
import { runLintCli } from "./lint.js";
import { loadSourceConfig } from "../source/config.js";
import { openSource } from "../source/open.js";
import { listEvals } from "../source/registry.js";
import { runMatrix } from "../run/matrix.js";
import { listRuns, loadLatestMatrix, loadRunResult } from "../report/load.js";
import { renderMatrixMarkdown, renderRunsMarkdown } from "../report/render-md.js";
import { renderMatrixTable, renderRunsTable } from "../report/render-table.js";
import type {
  AggregatedCell,
  EvalMatrixOptions,
  EvalRunResult,
  JudgeOverrideSpec,
  SourceConfig
} from "../types.js";

type ReportFormat = "json" | "md" | "table";

const initParams = S.Object({
  name: S.String({ description: "Eval folder name" }),
  cwd: S.Optional(
    S.String({
      description: "Eval source directory",
      short: "C"
    })
  ),
  kind: S.Optional(
    S.Enum(["plan", "pipeline", "superintendent", "experiment"] as const, {
      description: "Plan kind"
    })
  ),
  targetRepo: S.Optional(S.String({ description: "Target git repository" })),
  targetRef: S.Optional(S.String({ description: "Target git ref" }))
});

const checkParams = S.Object({
  evalId: S.Optional(S.String({ description: "Eval id to check" })),
  cwd: S.Optional(
    S.String({
      description: "Eval source directory",
      short: "C"
    })
  )
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
  out: S.Optional(S.String({ description: "Output directory" }))
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
  out: S.Optional(S.String({ description: "Runs output directory" }))
});

export const evalRunCommand = defineCommand({
  name: "run",
  description: "Run an eval matrix.",
  params: runParams,
  scope: ["cli", "sdk"],
  handler: async ({ params }) => {
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
      process.stdout.write(`${renderRunsTable(runs)}\n`);
    }

    return null;
  },
  render: {
    rich: () => {},
    markdown: () => "",
    json: () => undefined
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

    if (params.runId !== undefined) {
      const run = await loadRunResult(params.runId, outDir);
      printRunsReport([run], params.format);
      return null;
    }

    if (params.allRuns === true) {
      const runIds = await listRuns(outDir);
      const runs = await Promise.all(runIds.map((runId) => loadRunResult(runId, outDir)));
      printRunsReport(runs, params.format);
      return null;
    }

    const matrix = await loadLatestMatrix(outDir);
    printMatrixReport(matrix.cells, params.format);
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

function printRunsReport(runs: readonly EvalRunResult[], format: ReportFormat): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${format === "md" ? renderRunsMarkdown(runs) : renderRunsTable(runs)}\n`);
}

function printMatrixReport(cells: readonly AggregatedCell[], format: ReportFormat): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(cells, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `${format === "md" ? renderMatrixMarkdown(cells) : renderMatrixTable(cells)}\n`
  );
}
