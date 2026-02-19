import path from "node:path";
import { vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { stringify } from "yaml";
import { buildLoop, type BuildLoopOptions, type BuildResult } from "../build/loop.js";
import { parsePlan } from "../plan/parser.js";
import type { Plan, Story } from "../plan/types.js";

type SimulationFileSystem = {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
};

type AgentOutput = {
  stdout: string;
  stderr?: string;
  exitCode?: number;
};

type TurnContext = {
  iteration: number;
  storyId: string | null;
  fs: SimulationFileSystem;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  readPlan: () => Promise<Plan>;
};

export type TurnSpec = {
  /**
   * Assertion callback that runs BEFORE the agent "responds".
   * Use this to verify the prompt contains expected content.
   */
  assertPrompt?: (prompt: string, ctx: TurnContext) => void | Promise<void>;

  /**
   * Files the "agent" creates/modifies during this turn.
   * Applied after assertPrompt, before returning agent output.
   * Paths are relative to cwd (/).
   */
  fileChanges?: Record<string, string>;

  /**
   * The agent's output for this turn.
   */
  output: AgentOutput;
};

export type PartialStory = Partial<Story> & { id: string; title: string };

export type PartialPlan = Partial<Omit<Plan, "stories">> & {
  stories: PartialStory[];
};

export type OverbakeResponse = "continue" | "skip" | "abort";

export type SimulationOptions = {
  /**
   * Plan definition. Stories only require id and title; other fields have defaults.
   */
  plan: PartialPlan;

  /**
   * Custom prompt template. If not provided, uses a minimal default.
   */
  promptTemplate?: string;

  /**
   * Additional files to include in the filesystem.
   * Paths are relative to cwd (/).
   */
  files?: Record<string, string>;

  /**
   * Build loop configuration overrides.
   */
  config?: Partial<
    Pick<
      BuildLoopOptions,
      | "maxIterations"
      | "maxFailures"
      | "pauseOnOverbake"
      | "noCommit"
      | "agent"
      | "staleSeconds"
      | "progressPath"
      | "guardrailsPath"
      | "errorsLogPath"
      | "activityLogPath"
    >
  >;

  /**
   * Turn specifications. Each turn defines assertions and agent behavior.
   */
  turns: TurnSpec[];

  /**
   * Fixed timestamp for deterministic tests. Defaults to 2026-02-02T00:00:00.000Z
   */
  now?: Date;

  /**
   * Fixed run ID for deterministic tests.
   */
  runId?: string;

  /**
   * How to respond when overbake is detected. Can be a fixed response or a function
   * that returns a response based on the warning details.
   * Defaults to "continue".
   */
  onOverbake?: OverbakeResponse | ((warning: OverbakeWarning) => OverbakeResponse);
};

export type OverbakeWarning = {
  storyId: string;
  storyTitle: string;
  consecutiveFailures: number;
  threshold: number;
};

export type SimulationResult = {
  /**
   * The result from buildLoop.
   */
  result: BuildResult;

  /**
   * All prompts sent to the agent, in order.
   */
  prompts: string[];

  /**
   * Overbake warnings that were triggered.
   */
  overbakeWarnings: OverbakeWarning[];

  /**
   * The filesystem after the simulation completes.
   */
  fs: SimulationFileSystem;

  /**
   * Read file content from the final filesystem state.
   */
  readFile: (filePath: string) => Promise<string>;

  /**
   * Read and parse the plan from the final filesystem state.
   */
  readPlan: () => Promise<Plan>;

  /**
   * Get story by ID from the final PRD state.
   */
  getStory: (storyId: string) => Promise<Story | undefined>;

  /**
   * Read the run log for a specific iteration.
   */
  readRunLog: (iteration: number) => Promise<string>;

  /**
   * Read the run metadata for a specific iteration.
   */
  readRunMeta: (iteration: number) => Promise<string>;
};

const DEFAULT_PROMPT_TEMPLATE = [
  "# Build Prompt",
  "",
  "Story: {{STORY_ID}}",
  "Title: {{STORY_TITLE}}",
  "",
  "{{STORY_BLOCK}}",
  "",
  "PRD: {{PLAN_PATH}}",
  "Progress: {{PROGRESS_PATH}}",
  "Guardrails: {{GUARDRAILS_PATH}}",
  "Errors: {{ERRORS_LOG_PATH}}",
  "Activity: {{ACTIVITY_LOG_PATH}}",
  "",
  "No-commit: {{NO_COMMIT}}",
  "Run: {{RUN_ID}} Iteration: {{ITERATION}}",
  "",
  "Quality Gates:",
  "{{QUALITY_GATES}}",
  ""
].join("\n");

function normalizePlan(partial: PartialPlan): Plan {
  return {
    version: partial.version ?? 1,
    project: partial.project ?? "Test Project",
    overview: partial.overview,
    goals: partial.goals ?? [],
    nonGoals: partial.nonGoals ?? [],
    qualityGates: partial.qualityGates ?? [],
    stories: partial.stories.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status ?? "open",
      dependsOn: s.dependsOn ?? [],
      description: s.description,
      acceptanceCriteria: s.acceptanceCriteria ?? [],
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      updatedAt: s.updatedAt
    }))
  };
}

function createSimulationFs(
  initialFiles: Record<string, string>
): SimulationFileSystem {
  const vol = Volume.fromJSON(initialFiles, "/");
  const memfs = createFsFromVolume(vol);

  return {
    async readFile(filePath: string, encoding: BufferEncoding): Promise<string> {
      return memfs.promises.readFile(filePath, encoding) as Promise<string>;
    },
    async writeFile(
      filePath: string,
      data: string,
      options?: { encoding?: BufferEncoding }
    ): Promise<void> {
      await memfs.promises.writeFile(filePath, data, options);
    },
    async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
      await memfs.promises.mkdir(dirPath, options);
    }
  };
}

async function noLock() {
  return async () => {};
}

/**
 * Create a Ralph build loop simulation for integration testing.
 *
 * @example
 * ```ts
 * const sim = createRalphSimulation({
 *   plan: {
 *     stories: [
 *       { id: "US-001", title: "First feature" },
 *       { id: "US-002", title: "Second feature" }
 *     ]
 *   },
 *   turns: [
 *     {
 *       assertPrompt: (prompt) => {
 *         expect(prompt).toContain("US-001");
 *       },
 *       output: { stdout: "working on it..." }
 *     },
 *     {
 *       assertPrompt: (prompt) => {
 *         expect(prompt).toContain("US-001");
 *       },
 *       output: { stdout: "<promise>COMPLETE</promise>" }
 *     }
 *   ]
 * });
 *
 * const { result } = await sim.run();
 * expect(result.storiesDone).toEqual(["US-001"]);
 * ```
 */
export function createRalphSimulation(options: SimulationOptions) {
  const prd = normalizePlan(options.plan);
  const promptTemplate = options.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE;
  const now = options.now ?? new Date("2026-02-02T00:00:00.000Z");
  const runId = options.runId ?? "test-run-001";

  const planPath = "/.agents/poe-code-ralph/plans/plan.yaml";
  const promptPath = "/.agents/poe-code-ralph/PROMPT_build.md";
  const progressPath = options.config?.progressPath ?? ".poe-code-ralph/progress.md";
  const guardrailsPath = options.config?.guardrailsPath ?? ".poe-code-ralph/guardrails.md";
  const errorsLogPath = options.config?.errorsLogPath ?? ".poe-code-ralph/errors.log";
  const activityLogPath = options.config?.activityLogPath ?? ".poe-code-ralph/activity.log";

  const initialFiles: Record<string, string> = {
    [planPath]: stringify(prd),
    [promptPath]: promptTemplate,
    [`/${progressPath}`]: "# Progress\n",
    [`/${guardrailsPath}`]: "# Guardrails\n",
    [`/${errorsLogPath}`]: "",
    [`/${activityLogPath}`]: "",
    ...Object.fromEntries(
      Object.entries(options.files ?? {}).map(([p, content]) => [
        p.startsWith("/") ? p : `/${p}`,
        content
      ])
    )
  };

  const fs = createSimulationFs(initialFiles);

  const capturedPrompts: string[] = [];
  const overbakeWarnings: OverbakeWarning[] = [];
  let turnIndex = 0;

  const createContext = (iteration: number, storyId: string | null): TurnContext => ({
    iteration,
    storyId,
    fs,
    readFile: (filePath: string) =>
      fs.readFile(filePath.startsWith("/") ? filePath : `/${filePath}`, "utf8"),
    writeFile: async (filePath: string, content: string) => {
      const absPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, content, { encoding: "utf8" });
    },
    readPlan: async () => {
      const content = await fs.readFile(planPath, "utf8");
      return parsePlan(content);
    }
  });

  const spawn = vi.fn(
    async (
      _agent: string,
      spawnOptions: { prompt: string; cwd?: string; useStdin?: boolean }
    ) => {
      const turn = options.turns[turnIndex];
      if (!turn) {
        throw new Error(
          `Simulation: unexpected turn ${turnIndex + 1}. Only ${options.turns.length} turns defined.`
        );
      }

      capturedPrompts.push(spawnOptions.prompt);

      // Extract story ID from prompt for context
      const storyIdMatch = spawnOptions.prompt.match(/Story:\s*(\S+)/);
      const storyId = storyIdMatch ? storyIdMatch[1] : null;

      const ctx = createContext(turnIndex + 1, storyId ?? null);

      // Run assertion
      if (turn.assertPrompt) {
        await turn.assertPrompt(spawnOptions.prompt, ctx);
      }

      // Apply file changes
      if (turn.fileChanges) {
        for (const [filePath, content] of Object.entries(turn.fileChanges)) {
          await ctx.writeFile(filePath, content);
        }
      }

      turnIndex++;

      return {
        stdout: turn.output.stdout,
        stderr: turn.output.stderr ?? "",
        exitCode: turn.output.exitCode ?? 0
      };
    }
  );

  const promptOverbake = vi.fn(
    async (args: {
      storyId: string;
      storyTitle: string;
      consecutiveFailures: number;
      threshold: number;
    }) => {
      overbakeWarnings.push(args);
      const onOverbake = options.onOverbake ?? "continue";
      if (typeof onOverbake === "function") {
        return onOverbake(args);
      }
      return onOverbake;
    }
  );

  const stderr = { write: () => {} };

  return {
    /**
     * Run the simulation and return results.
     */
    async run(): Promise<SimulationResult> {
      // Default maxIterations to turns.length + 1 to allow "no_actionable_stories" detection
      // after all defined turns complete. For empty turns, use 1 to let empty plan be detected.
      const maxIterations =
        options.config?.maxIterations ??
        (options.turns.length > 0 ? options.turns.length + 1 : 1);

      const result = await buildLoop({
        planPath,
        progressPath,
        guardrailsPath,
        errorsLogPath,
        activityLogPath,
        maxIterations,
        maxFailures: options.config?.maxFailures,
        pauseOnOverbake: options.config?.pauseOnOverbake ?? true,
        noCommit: options.config?.noCommit ?? true,
        agent: options.config?.agent ?? "test-agent",
        staleSeconds: options.config?.staleSeconds ?? 0,
        cwd: "/",
        deps: {
          fs,
          lock: noLock,
          spawn,
          runId,
          stderr,
          promptOverbake,
          git: {
            getHead: () => null,
            getCommitList: () => [],
            getChangedFiles: () => [],
            getDirtyFiles: () => []
          },
          now: () => now
        }
      });

      const readFile = (filePath: string) =>
        fs.readFile(filePath.startsWith("/") ? filePath : `/${filePath}`, "utf8");

      const readPlan = async () => {
        const content = await fs.readFile(planPath, "utf8");
        return parsePlan(content);
      };

      const getStory = async (storyId: string) => {
        const prdData = await readPlan();
        return prdData.stories.find((s) => s.id === storyId);
      };

      const readRunLog = (iteration: number) =>
        readFile(`/.poe-code-ralph/runs/run-${runId}-iter-${iteration}.log`);

      const readRunMeta = (iteration: number) =>
        readFile(`/.poe-code-ralph/runs/run-${runId}-iter-${iteration}.md`);

      return {
        result,
        prompts: capturedPrompts,
        overbakeWarnings,
        fs,
        readFile,
        readPlan,
        getStory,
        readRunLog,
        readRunMeta
      };
    },

    /**
     * Access the spawn mock for additional assertions.
     */
    spawnMock: spawn,

    /**
     * Access the overbake prompt mock for additional assertions.
     */
    overbakePromptMock: promptOverbake
  };
}

/**
 * Helper to create a turn that simulates successful completion.
 */
export function completeTurn(
  assertPrompt?: TurnSpec["assertPrompt"],
  fileChanges?: TurnSpec["fileChanges"]
): TurnSpec {
  return {
    assertPrompt,
    fileChanges,
    output: { stdout: "<promise>COMPLETE</promise>", exitCode: 0 }
  };
}

/**
 * Helper to create a turn that simulates incomplete work.
 */
export function incompleteTurn(
  stdout: string,
  assertPrompt?: TurnSpec["assertPrompt"],
  fileChanges?: TurnSpec["fileChanges"]
): TurnSpec {
  return {
    assertPrompt,
    fileChanges,
    output: { stdout, exitCode: 0 }
  };
}

/**
 * Helper to create a turn that simulates a failure.
 */
export function failTurn(
  stderr: string,
  assertPrompt?: TurnSpec["assertPrompt"]
): TurnSpec {
  return {
    assertPrompt,
    output: { stdout: "", stderr, exitCode: 1 }
  };
}
