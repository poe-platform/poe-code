import { expect } from "vitest";
import {
  declareHostOperation,
  type HostCallRecord,
  type HostCallResumeRequest
} from "../../src/index.js";

export const originalScenarios: Array<{
  id: string;
  source: string;
  sourcePath: string;
  policy: "re-issue" | "read-side-effect";
  expected: unknown;
  calls: unknown[][];
  callsAtBoundary: unknown[][];
  resumeCalls: unknown[][];
}> = [
  {
    id: "reduction",
    source:
      'const first = await lookup(2);\nconst final = await checkpoint("hold");\nreturn { first, final };\n',
    sourcePath: "async-replay/reductions/10-external-dump.js",
    policy: "re-issue",
    expected: {
      first: 20,
      final: 13
    },
    calls: [
      ["lookup", 2],
      ["checkpoint", "hold"]
    ],
    callsAtBoundary: [
      ["lookup", 2],
      ["checkpoint", "hold"]
    ],
    resumeCalls: [["checkpoint", "hold"]]
  },
  {
    id: "callback",
    source:
      'const trace = [];\nconst result = [];\nconst counters = { callbacks: 0, total: 0 };\nconst batches = [[2, 3], [5, 7], [11, 13]];\nfor (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {\n  const original = batches[batchIndex];\n  const batch = await visit(original, async (item, index) => {\n    counters.callbacks++;\n    const value = await lookup(item);\n    counters.total += value;\n    trace.push([batchIndex, index, item, value]);\n    const captured = value + batchIndex;\n    return { item, compute: (extra) => captured + extra };\n  });\n  result.push(batch.map((item) => [item.item, item.compute(1)]));\n  await checkpoint("batch:" + batchIndex);\n}\nreturn { result, counters, trace };\n',
    sourcePath: "async-replay/examples/05-callback-checkpoint.js",
    policy: "re-issue",
    expected: {
      result: [
        [
          [2, 21],
          [3, 31]
        ],
        [
          [5, 52],
          [7, 72]
        ],
        [
          [11, 113],
          [13, 133]
        ]
      ],
      counters: {
        callbacks: 6,
        total: 410
      },
      trace: [
        [0, 0, 2, 20],
        [0, 1, 3, 30],
        [1, 0, 5, 50],
        [1, 1, 7, 70],
        [2, 0, 11, 110],
        [2, 1, 13, 130]
      ]
    },
    calls: [
      ["visit", [2, 3]],
      ["lookup", 2],
      ["lookup", 3],
      ["checkpoint", "batch:0"],
      ["visit", [5, 7]],
      ["lookup", 5],
      ["lookup", 7],
      ["checkpoint", "batch:1"],
      ["visit", [11, 13]],
      ["lookup", 11],
      ["lookup", 13],
      ["checkpoint", "batch:2"]
    ],
    callsAtBoundary: [
      ["visit", [2, 3]],
      ["lookup", 2],
      ["lookup", 3]
    ],
    resumeCalls: [
      ["visit", [2, 3]],
      ["lookup", 3],
      ["checkpoint", "batch:0"],
      ["visit", [5, 7]],
      ["lookup", 5],
      ["lookup", 7],
      ["checkpoint", "batch:1"],
      ["visit", [11, 13]],
      ["lookup", 11],
      ["lookup", 13],
      ["checkpoint", "batch:2"]
    ]
  },
  {
    id: "retry-reissue",
    source:
      'const trace = [];\nconst values = [];\nconst errors = [];\nconst jobs = payload.jobs;\nlet cursor = 0;\nconst worker = async (workerId) => {\n  while (cursor < jobs.length) {\n    const index = cursor++;\n    const job = jobs[index];\n    payload.started++;\n    for (let attempt = 1; attempt <= 3; attempt++) {\n      try {\n        trace.push(["start", job.id, attempt, workerId]);\n        const value = await operation(job.id, attempt, job.value);\n        values[index] = { id: job.id, value, attempt };\n        payload.completed++;\n        break;\n      } catch (error) {\n        trace.push(["error", job.id, attempt, error.message]);\n        if (attempt === 3) errors.push({ id: job.id, message: error.message });\n        else await checkpoint("retry:" + job.id + ":" + attempt);\n      } finally {\n        trace.push(["finally", job.id, attempt, workerId]);\n      }\n    }\n  }\n};\nawait Promise.all([worker(0), worker(1)]);\nawait checkpoint("finished");\nreturn { values, errors, trace, started: payload.started, completed: payload.completed };\n',
    sourcePath: "async-replay/examples/06-pending-retry-map.js",
    policy: "re-issue",
    expected: {
      values: [
        {
          id: "a",
          value: 21,
          attempt: 1
        },
        {
          id: "b",
          value: 32,
          attempt: 2
        },
        {
          id: "c",
          value: 51,
          attempt: 1
        }
      ],
      errors: [],
      trace: [
        ["start", "a", 1, 0],
        ["start", "b", 1, 1],
        ["finally", "a", 1, 0],
        ["start", "c", 1, 0],
        ["error", "b", 1, "transient:b"],
        ["finally", "b", 1, 1],
        ["start", "b", 2, 1],
        ["finally", "b", 2, 1],
        ["finally", "c", 1, 0]
      ],
      started: 3,
      completed: 3
    },
    calls: [
      ["operation", "a", 1, 2],
      ["operation", "b", 1, 3],
      ["operation", "c", 1, 5],
      ["checkpoint", "retry:b:1"],
      ["operation", "b", 2, 3],
      ["checkpoint", "finished"]
    ],
    callsAtBoundary: [
      ["operation", "a", 1, 2],
      ["operation", "b", 1, 3],
      ["operation", "c", 1, 5],
      ["checkpoint", "retry:b:1"],
      ["operation", "b", 2, 3]
    ],
    resumeCalls: [
      ["operation", "c", 1, 5],
      ["checkpoint", "finished"]
    ]
  },
  {
    id: "retry-external",
    source:
      'const trace = [];\nconst values = [];\nconst errors = [];\nconst jobs = payload.jobs;\nlet cursor = 0;\nconst worker = async (workerId) => {\n  while (cursor < jobs.length) {\n    const index = cursor++;\n    const job = jobs[index];\n    payload.started++;\n    for (let attempt = 1; attempt <= 3; attempt++) {\n      try {\n        trace.push(["start", job.id, attempt, workerId]);\n        const value = await operation(job.id, attempt, job.value);\n        values[index] = { id: job.id, value, attempt };\n        payload.completed++;\n        break;\n      } catch (error) {\n        trace.push(["error", job.id, attempt, error.message]);\n        if (attempt === 3) errors.push({ id: job.id, message: error.message });\n        else await checkpoint("retry:" + job.id + ":" + attempt);\n      } finally {\n        trace.push(["finally", job.id, attempt, workerId]);\n      }\n    }\n  }\n};\nawait Promise.all([worker(0), worker(1)]);\nawait checkpoint("finished");\nreturn { values, errors, trace, started: payload.started, completed: payload.completed };\n',
    sourcePath: "async-replay/examples/06-pending-retry-map.js",
    policy: "read-side-effect",
    expected: {
      values: [
        {
          id: "a",
          value: 21,
          attempt: 1
        },
        {
          id: "b",
          value: 32,
          attempt: 2
        },
        {
          id: "c",
          value: 51,
          attempt: 1
        }
      ],
      errors: [],
      trace: [
        ["start", "a", 1, 0],
        ["start", "b", 1, 1],
        ["finally", "a", 1, 0],
        ["start", "c", 1, 0],
        ["error", "b", 1, "transient:b"],
        ["finally", "b", 1, 1],
        ["start", "b", 2, 1],
        ["finally", "b", 2, 1],
        ["finally", "c", 1, 0]
      ],
      started: 3,
      completed: 3
    },
    calls: [
      ["operation", "a", 1, 2],
      ["operation", "b", 1, 3],
      ["operation", "c", 1, 5],
      ["checkpoint", "retry:b:1"],
      ["operation", "b", 2, 3],
      ["checkpoint", "finished"]
    ],
    callsAtBoundary: [
      ["operation", "a", 1, 2],
      ["operation", "b", 1, 3],
      ["operation", "c", 1, 5],
      ["checkpoint", "retry:b:1"],
      ["operation", "b", 2, 3]
    ],
    resumeCalls: [["checkpoint", "finished"]]
  },
  {
    id: "co",
    source:
      'const trace = [];\nconst resolveYieldable = async (value) => {\n  if (value !== null && typeof value === "object" && typeof value.next === "function") return drive(value);\n  if (Array.isArray(value)) return Promise.all(value.map(resolveYieldable));\n  if (value !== null && typeof value === "object" && typeof value.then !== "function") {\n    const result = {};\n    const keys = Object.keys(value);\n    await Promise.all(keys.map(async (key) => {\n      result[key] = await resolveYieldable(value[key]);\n    }));\n    return result;\n  }\n  return await value;\n};\nconst drive = async (generator) => {\n  let method = "next";\n  let input;\n  for (let step = 0; step < 20; step++) {\n    const next = generator[method](input);\n    if (next.done) return next.value;\n    try {\n      input = await resolveYieldable(next.value);\n      method = "next";\n    } catch (error) {\n      input = error;\n      method = "throw";\n    }\n  }\n  throw Error("generator step cap");\n};\nfunction* nested(seed) {\n  const values = yield [Promise.resolve(seed), { extra: Promise.resolve(seed + 1) }];\n  return values[0] + values[1].extra;\n}\nfunction* workflow() {\n  try {\n    const first = yield { left: nested(2), right: [Promise.resolve(7), Promise.resolve(11)] };\n    trace.push(["first", first.left, first.right[0], first.right[1]]);\n    try {\n      yield Promise.reject(Error("transient"));\n    } catch (error) {\n      trace.push(["caught", error.message]);\n      const recovered = yield checkpoint("co-recover");\n      return first.left + first.right[0] + first.right[1] + recovered;\n    }\n  } finally {\n    trace.push(["finally"]);\n  }\n}\nconst value = await drive(workflow());\nreturn { value, trace };\n',
    sourcePath: "async-replay/examples/07-co-live-checkpoint.js",
    policy: "re-issue",
    expected: {
      value: 36,
      trace: [["first", 5, 7, 11], ["caught", "transient"], ["finally"]]
    },
    calls: [["checkpoint", "co-recover"]],
    callsAtBoundary: [["checkpoint", "co-recover"]],
    resumeCalls: [["checkpoint", "co-recover"]]
  }
];

export function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function makeFixture(
  scenario: string,
  hold = true,
  policy: "re-issue" | "read-side-effect" = "re-issue"
) {
  const gate = deferred<void>();
  const entered = deferred<void>();
  const calls: unknown[][] = [];
  let held = false;
  const bindings = {
    payload: {
      jobs: [
        { id: "a", value: 2 },
        { id: "b", value: 3 },
        { id: "c", value: 5 }
      ],
      started: 0,
      completed: 0
    },
    lookup: declareHostOperation(async (item: number) => {
      calls.push(["lookup", item]);
      if (hold && scenario === "callback" && item === 3) {
        held = true;
        entered.resolve();
        await gate.promise;
      }
      await Promise.resolve();
      return item * 10;
    }, "re-issue"),
    checkpoint: declareHostOperation(async (label: string) => {
      calls.push(["checkpoint", label]);
      if (
        hold &&
        ((scenario === "reduction" && label === "hold") ||
          (scenario === "co" && label === "co-recover"))
      ) {
        held = true;
        entered.resolve();
        await gate.promise;
      }
      return label === "hold" || label === "co-recover" ? 13 : label;
    }, "re-issue"),
    visit: declareHostOperation(
      async (items: number[], callback: (item: number, index: number) => Promise<unknown>) => {
        calls.push(["visit", [...items]]);
        const output: unknown[] = [];
        for (let index = 0; index < items.length; index++)
          output.push(await callback(items[index]!, index));
        return output;
      },
      "re-issue"
    ),
    operation: declareHostOperation(async (id: string, attempt: number, value: number) => {
      calls.push(["operation", id, attempt, value]);
      if (hold && scenario.startsWith("retry") && id === "c" && attempt === 1) {
        held = true;
        entered.resolve();
        await gate.promise;
      }
      await Promise.resolve();
      if (id === "b" && attempt === 1) throw Error("transient:b");
      return value * 10 + attempt;
    }, policy)
  };
  return {
    bindings,
    calls,
    entered: entered.promise,
    isHeld: () => held,
    release: () => {
      held = false;
      gate.resolve();
    }
  };
}

export function receiptsProvider(receipts: HostCallRecord[], requests: HostCallResumeRequest[]) {
  return async (request: HostCallResumeRequest) => {
    requests.push(request);
    const receipt = receipts.find((entry) => entry.id === request.callId);
    if (receipt?.outcome === undefined) throw new Error("No completed observed receipt");
    for (const key of ["sourceHash", "moduleId", "operation", "argumentDigest"] as const) {
      expect(receipt[key]).toBe(request[key]);
    }
    return {
      callId: receipt.id,
      sourceHash: receipt.sourceHash,
      moduleId: receipt.moduleId,
      operation: receipt.operation,
      argumentDigest: receipt.argumentDigest,
      outcome: receipt.outcome
    };
  };
}
