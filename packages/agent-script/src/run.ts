import { hashSource } from "./parse/hash.js";
import type { ParseResult } from "./parse.js";
import { parseModule, type Module, type Statement } from "./parse/parser.js";
import { restore, type AgentScriptSnapshot } from "./restore.js";
import { Budget } from "./interp/budget.js";
import { wrapCancelableBindings } from "./interp/cancel.js";
import { createConsoleJsonGlobals, type ConsoleSink } from "./interp/globals/console-json.js";
import { createErrorGlobals } from "./interp/globals/error.js";
import { createMathGlobals, createSeededRandom } from "./interp/globals/math.js";
import { createObjectArrayGlobals } from "./interp/globals/object-array.js";
import { wrapCallerInjectedBindings, type CallerInjectedBinding } from "./interp/host-bridge.js";
import { interpret, Scope, type InterpreterResult } from "./interp/interpreter.js";
import { createPromiseGlobals } from "./interp/promise.js";
import { resolveModuleImports, type ModuleRegistry } from "./modules/registry.js";
import { createSnapshotScheduler } from "./snapshot/scheduler.js";

export type RunOptions = {
  bindings?: Record<string, CallerInjectedBinding>;
  budget?: Budget;
  modules?: ModuleRegistry;
  randomSeed?: number;
  signal?: AbortSignal;
  snapshot?: AgentScriptSnapshot;
  snapshotIntervalMs?: number;
  snapshotPath?: string;
  sink?: ConsoleSink;
};

export type RunSnapshot = AgentScriptSnapshot & {
  bindings: InterpreterResult["snapshot"]["bindings"];
  random?: {
    seed: number;
    state: number;
  };
};

export type RunResult = Omit<InterpreterResult, "snapshot"> & {
  snapshot: RunSnapshot;
};

export async function run(source: string, options: RunOptions = {}): Promise<RunResult> {
  const restoredSnapshot =
    options.snapshot === undefined ? undefined : restore(options.snapshot, { source });
  const budget = options.budget ?? new Budget();
  const module = parseModule(source);
  const sourceHash = hashSource(source);
  const random = createRandomState(restoredSnapshot, options.randomSeed);
  const callerBindings =
    options.bindings === undefined
      ? {}
      : wrapCallerInjectedBindings(options.bindings, {
          budget
        });
  const bindings = wrapCancelableBindings(
    {
      ...createConsoleJsonGlobals({
        budget,
        sink: options.sink
      }),
      ...createErrorGlobals({
        budget
      }),
      ...createMathGlobals({
        random: random?.generator.next
      }),
      ...createObjectArrayGlobals({
        budget
      }),
      ...createPromiseGlobals({
        budget
      }),
      ...callerBindings
    },
    options.signal
  );

  const scope = new Scope(bindings).child(resolveModuleImports(module, options.modules, { budget }));
  const snapshotScheduler = createSnapshotScheduler<RunSnapshot>({
    snapshotIntervalMs: options.snapshotIntervalMs,
    snapshotPath: options.snapshotPath
  });
  const result = await interpret(createExecutableNode(module), {
    budget,
    onYield: (yieldPoint) => {
      snapshotScheduler.onYield(() =>
        createRunSnapshot({
          bindings: yieldPoint.snapshot.bindings,
          random,
          sourceHash
        })
      );
    },
    scope
  });
  await snapshotScheduler.finish();

  return {
    ...result,
    snapshot: createRunSnapshot({
      bindings: result.snapshot.bindings,
      random,
      sourceHash
    })
  };
}

function createRandomState(
  snapshot: AgentScriptSnapshot | undefined,
  randomSeed: number | undefined
) {
  if (snapshot?.random !== undefined) {
    return {
      seed: snapshot.random.seed,
      generator: createSeededRandom(snapshot.random.state)
    };
  }

  if (randomSeed === undefined) {
    return undefined;
  }

  return {
    seed: Math.trunc(randomSeed),
    generator: createSeededRandom(randomSeed)
  };
}

function createExecutableNode(module: Module): ParseResult {
  const executableStatements = module.body.filter(
    (statement): statement is Exclude<Statement, { type: "ImportDeclaration" }> => statement.type !== "ImportDeclaration"
  );

  if (executableStatements.length === 0) {
    return {
      type: "BlockStatement",
      body: [],
      span: module.span
    };
  }

  if (executableStatements.length === 1) {
    const [statement] = executableStatements;
    return statement.type === "ExpressionStatement" ? statement.expression : statement;
  }

  return {
    type: "BlockStatement",
    body: executableStatements,
    span: module.span
  };
}

function createRunSnapshot(input: {
  bindings: InterpreterResult["snapshot"]["bindings"];
  random:
    | {
        seed: number;
        generator: ReturnType<typeof createSeededRandom>;
      }
    | undefined;
  sourceHash: string;
}): RunSnapshot {
  return {
    sourceHash: input.sourceHash,
    bindings: input.bindings,
    random:
      input.random === undefined
        ? undefined
        : {
            seed: input.random.seed,
            state: input.random.generator.snapshot()
          }
  };
}
