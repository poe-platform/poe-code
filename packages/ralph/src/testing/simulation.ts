import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { resolveWorkflowPath } from "@poe-code/agent-harness-tools";
import { runRalph } from "../run/ralph.js";
import type {
  AgentRunInput,
  AgentRunResult,
  RalphFileSystem,
  RalphRunResult
} from "../types.js";

type SimulationFs = RalphFileSystem;

type TurnContext = {
  fs: SimulationFs;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
};

type TurnOutput = {
  stdout: string;
  stderr?: string;
  exitCode?: number;
};

export type TurnSpec = {
  assertPrompt?: (prompt: string, ctx: TurnContext) => void | Promise<void>;
  fileChanges?: Record<string, string>;
  output: TurnOutput;
};

export type SimulationOptions = {
  agent?: string | string[];
  docContent?: string;
  docPath?: string;
  maxIterations: number;
  archive?: boolean;
  turns: TurnSpec[];
  files?: Record<string, string>;
  signal?: AbortSignal;
};

export type SimulationRun = AgentRunInput;

export type SimulationResult = {
  result: RalphRunResult;
  prompts: string[];
  runs: SimulationRun[];
  fs: SimulationFs;
  readFile: (filePath: string) => Promise<string>;
};

function createSimulationFs(options: SimulationOptions): {
  fs: SimulationFs;
  docPath: string;
  cwd: string;
  homeDir: string;
  rawFs: ReturnType<typeof createFsFromVolume>["promises"];
} {
  const cwd = "/repo";
  const homeDir = "/home/test";
  const docPath = options.docPath ?? ".poe-code/ralph/plans/plan.md";
  const absoluteDocPath = resolveWorkflowPath(docPath, cwd, homeDir);
  const files: Record<string, string> = {
    [absoluteDocPath]: options.docContent ?? "Run the loop",
    ...Object.fromEntries(
      Object.entries(options.files ?? {}).map(([filePath, content]) => [
        path.join(cwd, filePath),
        content
      ])
    )
  };
  const volume = Volume.fromJSON(files, "/");
  const rawFs = createFsFromVolume(volume).promises;

  const fs = {
    readFile: (filePath, encoding) =>
      rawFs.readFile(filePath, encoding) as Promise<string>,
    writeFile: async (filePath, content, options) => {
      await rawFs.mkdir(path.dirname(filePath), { recursive: true });
      await rawFs.writeFile(filePath, content, { encoding: "utf8", ...options });
    },
    readdir: (filePath) => rawFs.readdir(filePath) as Promise<string[]>,
    open: (filePath: string, flags: string) => rawFs.open(filePath, flags),
    lstat: async (filePath: string) => {
      const stat = await rawFs.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    stat: async (filePath) => {
      const stat = await rawFs.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: Number(stat.mtimeMs)
      };
    },
    unlink: async (filePath: string) => {
      await rawFs.unlink(filePath);
    },
    mkdir: async (filePath, options) => {
      await rawFs.mkdir(filePath, options);
    },
    rmdir: async (filePath) => {
      await rawFs.rmdir(filePath);
    },
    realpath: (filePath: string) => rawFs.realpath(filePath) as Promise<string>,
    rename: async (oldPath, newPath) => {
      await rawFs.mkdir(path.dirname(newPath), { recursive: true });
      await rawFs.rename(oldPath, newPath);
    }
  } as SimulationFs;

  return {
    fs,
    docPath,
    cwd,
    homeDir,
    rawFs
  };
}

async function applyFileChanges(
  rawFs: ReturnType<typeof createFsFromVolume>["promises"],
  cwd: string,
  changes: Record<string, string>
): Promise<void> {
  for (const [filePath, content] of Object.entries(changes)) {
    const absolutePath = path.join(cwd, filePath);
    await fsWriteFile(rawFs, absolutePath, content);
  }
}

async function fsWriteFile(
  rawFs: ReturnType<typeof createFsFromVolume>["promises"],
  absolutePath: string,
  content: string
): Promise<void> {
  await rawFs.mkdir(path.dirname(absolutePath), { recursive: true });
  await rawFs.writeFile(absolutePath, content, { encoding: "utf8" });
}

function normalizeAgentResult(output: TurnOutput): AgentRunResult {
  return {
    stdout: output.stdout,
    stderr: output.stderr ?? "",
    exitCode: output.exitCode ?? 0
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
  assertPrompt?: TurnSpec["assertPrompt"],
  fileChanges?: Record<string, string>
): TurnSpec {
  return {
    ...(assertPrompt ? { assertPrompt } : {}),
    ...(fileChanges ? { fileChanges } : {}),
    output: {
      stdout: "",
      stderr,
      exitCode: 1
    }
  };
}

export function createRalphSimulation(options: SimulationOptions): {
  run: () => Promise<SimulationResult>;
} {
  return {
    async run(): Promise<SimulationResult> {
      const { fs, docPath, cwd, homeDir, rawFs } = createSimulationFs(options);
      const turns = [...options.turns];
      const prompts: string[] = [];
      const runs: SimulationRun[] = [];

      const readFile = async (filePath: string): Promise<string> =>
        fs.readFile(path.join(cwd, filePath), "utf8");
      const writeFile = async (filePath: string, content: string): Promise<void> =>
        fsWriteFile(rawFs, path.join(cwd, filePath), content);

      const result = await runRalph({
        agent: options.agent ?? "codex",
        cwd,
        homeDir,
        docPath,
        maxIterations: options.maxIterations,
        archive: options.archive,
        ...(options.signal ? { signal: options.signal } : {}),
        fs,
        runAgent: async (input) => {
          const turn = turns.shift();
          if (!turn) {
            throw new Error("Ralph simulation ran out of turns.");
          }

          prompts.push(input.prompt);
          runs.push(input);

          if (turn.assertPrompt) {
            await turn.assertPrompt(input.prompt, {
              fs,
              readFile,
              writeFile
            });
          }

          if (turn.fileChanges) {
            await applyFileChanges(rawFs, cwd, turn.fileChanges);
          }

          return normalizeAgentResult(turn.output);
        }
      });

      return {
        result,
        prompts,
        runs,
        fs,
        readFile
      };
    }
  };
}
