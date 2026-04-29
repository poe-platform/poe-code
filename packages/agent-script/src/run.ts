import { hashSource } from "./parse/hash.js";
import { parse } from "./parse.js";
import { restore, type AgentScriptSnapshot } from "./restore.js";
import { Budget } from "./interp/budget.js";
import { wrapCancelableBindings } from "./interp/cancel.js";
import { createConsoleJsonGlobals, type ConsoleSink } from "./interp/globals/console-json.js";
import { createErrorGlobals } from "./interp/globals/error.js";
import { createMathGlobals, createSeededRandom } from "./interp/globals/math.js";
import { createObjectArrayGlobals } from "./interp/globals/object-array.js";
import { interpret, type InterpreterResult, type InterpreterValue } from "./interp/interpreter.js";
import { createPromiseGlobals } from "./interp/promise.js";

export type RunOptions = {
  bindings?: Record<string, InterpreterValue>;
  budget?: Budget;
  randomSeed?: number;
  signal?: AbortSignal;
  snapshot?: AgentScriptSnapshot;
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
  const restoredSnapshot = options.snapshot === undefined ? undefined : restore(options.snapshot, { source });
  const budget = options.budget ?? new Budget();
  const random = createRandomState(restoredSnapshot, options.randomSeed);
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
      ...options.bindings
    },
    options.signal
  );
  const result = await interpret(parse(source), {
    bindings,
    budget
  });

  return {
    ...result,
    snapshot: {
      sourceHash: hashSource(source),
      bindings: result.snapshot.bindings,
      random:
        random === undefined
          ? undefined
          : {
              seed: random.seed,
              state: random.generator.snapshot()
            }
    }
  };
}

function createRandomState(snapshot: AgentScriptSnapshot | undefined, randomSeed: number | undefined) {
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
