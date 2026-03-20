import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { stringify } from "yaml";
import { parsePlan } from "../plan/parser.js";
import { runPipeline } from "../run/pipeline.js";
import type {
  AgentRunInput,
  AgentRunResult,
  AgentRunUsage,
  PipelineFileSystem,
  PipelinePlan,
  PipelineRunOptions,
  PipelineRunResult,
  PipelineTask,
  ResolvedStepDefinitions
} from "../types.js";

type SimulationFs = PipelineFileSystem;

type TurnContext = {
  fs: SimulationFs;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  readPlan: () => Promise<PipelinePlan>;
};

type TurnOutput = {
  stdout: string;
  stderr?: string;
  exitCode?: number;
  usage?: AgentRunUsage;
};

export type TurnSpec = {
  assertPrompt?: (prompt: string, ctx: TurnContext) => void | Promise<void>;
  fileChanges?: Record<string, string>;
  output: TurnOutput;
};

export type SimulationOptions = {
  plan: PipelinePlan;
  globalSteps?: ResolvedStepDefinitions;
  projectSteps?: ResolvedStepDefinitions;
  turns: TurnSpec[];
  files?: Record<string, string>;
  config?: {
    maxRuns?: number;
    logDir?: string;
  };
  onPlanReloadError?: (error: Error) => void;
};

export type SimulationRun = AgentRunInput;
export type SimulationTaskCompletion =
  Parameters<NonNullable<PipelineRunOptions["onTaskComplete"]>>[0];

export type SimulationResult = {
  result: PipelineRunResult;
  prompts: string[];
  runs: SimulationRun[];
  taskCompletions: SimulationTaskCompletion[];
  fs: SimulationFs;
  readFile: (filePath: string) => Promise<string>;
  readPlan: () => Promise<PipelinePlan>;
  getTask: (taskId: string) => Promise<PipelineTask | undefined>;
};

function createSimulationFs(
  options: SimulationOptions
): { fs: SimulationFs; planPath: string } {
  const planPath = "/repo/.poe-code/pipeline/plans/plan.yaml";
  const files: Record<string, string> = {
    [planPath]: stringify(options.plan),
    ...Object.fromEntries(
      Object.entries(options.files ?? {}).map(([filePath, content]) => [
        path.join("/repo", filePath),
        content
      ])
    )
  };

  if (options.globalSteps) {
    files["/home/test/.poe-code/pipeline/steps.yaml"] = stringify({
      steps: options.globalSteps
    });
  }
  if (options.projectSteps) {
    files["/repo/.poe-code/pipeline/steps.yaml"] = stringify({
      steps: options.projectSteps
    });
  }

  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;
  const fs: SimulationFs = {
    readFile: (filePath, encoding) =>
      rawFs.readFile(filePath, encoding) as Promise<string>,
    writeFile: (filePath, data, writeOptions) =>
      rawFs.writeFile(filePath, data, writeOptions) as Promise<void>,
    readdir: (filePath) => rawFs.readdir(filePath) as Promise<string[]>,
    stat: async (filePath) => {
      const stat = await rawFs.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: Number(stat.mtimeMs)
      };
    },
    mkdir: (filePath, mkdirOptions) =>
      rawFs.mkdir(filePath, mkdirOptions) as Promise<void>,
    rmdir: (filePath) => rawFs.rmdir(filePath) as Promise<void>,
    rename: (oldPath, newPath) => rawFs.rename(oldPath, newPath) as Promise<void>
  };

  return { fs, planPath };
}

async function applyFileChanges(
  fs: SimulationFs,
  changes: Record<string, string>
): Promise<void> {
  for (const [filePath, content] of Object.entries(changes)) {
    const absolutePath = path.join("/repo", filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, { encoding: "utf8" });
  }
}

function normalizeAgentResult(output: TurnOutput): AgentRunResult {
  return {
    stdout: output.stdout,
    stderr: output.stderr ?? "",
    exitCode: output.exitCode ?? 0,
    ...(output.usage ? { usage: output.usage } : {})
  };
}

export function successTurn(
  assertPrompt?: TurnSpec["assertPrompt"],
  fileChanges?: Record<string, string>
): TurnSpec {
  return {
    ...(assertPrompt ? { assertPrompt } : {}),
    ...(fileChanges ? { fileChanges } : {}),
    output: {
      stdout: "",
      exitCode: 0
    }
  };
}

export function failTurn(
  stderr: string,
  assertPrompt?: TurnSpec["assertPrompt"]
): TurnSpec {
  return {
    ...(assertPrompt ? { assertPrompt } : {}),
    output: {
      stdout: "",
      stderr,
      exitCode: 1
    }
  };
}

export function createPipelineSimulation(options: SimulationOptions): {
  run: () => Promise<SimulationResult>;
} {
  return {
    async run(): Promise<SimulationResult> {
      const { fs, planPath } = createSimulationFs(options);
      const turns = [...options.turns];
      const prompts: string[] = [];
      const runs: SimulationRun[] = [];
      const taskCompletions: SimulationTaskCompletion[] = [];

      const readPlan = async (): Promise<PipelinePlan> => {
        const availableSteps = {
          ...(options.globalSteps ?? {}),
          ...(options.projectSteps ?? {})
        };
        const parseOpts = Object.keys(availableSteps).length > 0
          ? { availableSteps }
          : {};

        try {
          const content = await fs.readFile(planPath, "utf8");
          return parsePlan(content, parseOpts);
        } catch {
          const archivePath = path.join(
            path.dirname(planPath),
            "archive",
            path.basename(planPath)
          );
          const content = await fs.readFile(archivePath, "utf8");
          return parsePlan(content, parseOpts);
        }
      };

      const readFile = async (filePath: string): Promise<string> =>
        fs.readFile(path.join("/repo", filePath), "utf8");
      const writeFile = async (filePath: string, content: string): Promise<void> => {
        const absolutePath = path.join("/repo", filePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, { encoding: "utf8" });
      };

      const result = await runPipeline({
        agent: "codex",
        cwd: "/repo",
        homeDir: "/home/test",
        plan: ".poe-code/pipeline/plans/plan.yaml",
        maxRuns: options.config?.maxRuns,
        logDir: options.config?.logDir,
        onPlanReloadError: options.onPlanReloadError,
        fs,
        onTaskComplete: (progress) => {
          taskCompletions.push(progress);
        },
        runAgent: async (input) => {
          const turn = turns.shift();
          if (!turn) {
            throw new Error("Pipeline simulation ran out of turns.");
          }

          prompts.push(input.prompt);
          runs.push(input);

          if (turn.assertPrompt) {
            await turn.assertPrompt(input.prompt, {
              fs,
              readFile,
              writeFile,
              readPlan
            });
          }

          if (turn.fileChanges) {
            await applyFileChanges(fs, turn.fileChanges);
          }

          return normalizeAgentResult(turn.output);
        }
      });

      return {
        result,
        prompts,
        runs,
        taskCompletions,
        fs,
        readFile,
        readPlan,
        getTask: async (taskId: string) => (await readPlan()).tasks.find((task) => task.id === taskId)
      };
    }
  };
}
