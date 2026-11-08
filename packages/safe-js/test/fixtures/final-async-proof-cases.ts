export const originalSources = {
  callbackFunction:
    'const trace = [];\nconst result = [];\nconst counters = { callbacks: 0, total: 0 };\nconst batches = [[2, 3], [5, 7], [11, 13]];\nfor (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {\n  const original = batches[batchIndex];\n  const batch = await visit(original, async (item, index) => {\n    counters.callbacks++;\n    const value = await lookup(item);\n    counters.total += value;\n    trace.push([batchIndex, index, item, value]);\n    const captured = value + batchIndex;\n    return { item, compute: (extra) => captured + extra };\n  });\n  result.push(batch.map((item) => [item.item, item.compute(1)]));\n  await checkpoint("batch:" + batchIndex);\n}\nreturn { result, counters, trace };\n',
  retry:
    'const trace = [];\nconst values = [];\nconst errors = [];\nconst jobs = payload.jobs;\nlet cursor = 0;\nconst worker = async (workerId) => {\n  while (cursor < jobs.length) {\n    const index = cursor++;\n    const job = jobs[index];\n    payload.started++;\n    for (let attempt = 1; attempt <= 3; attempt++) {\n      try {\n        trace.push(["start", job.id, attempt, workerId]);\n        const value = await operation(job.id, attempt, job.value);\n        values[index] = { id: job.id, value, attempt };\n        payload.completed++;\n        break;\n      } catch (error) {\n        trace.push(["error", job.id, attempt, error.message]);\n        if (attempt === 3) errors.push({ id: job.id, message: error.message });\n        else await checkpoint("retry:" + job.id + ":" + attempt);\n      } finally {\n        trace.push(["finally", job.id, attempt, workerId]);\n      }\n    }\n  }\n};\nawait Promise.all([worker(0), worker(1)]);\nawait checkpoint("finished");\nreturn { values, errors, trace, started: payload.started, completed: payload.completed };\n',
  callbackData:
    'const trace = [];\nconst result = [];\nconst counters = { callbacks: 0, total: 0 };\nconst batches = [[2, 3], [5, 7], [11, 13]];\nfor (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {\n  const original = batches[batchIndex];\n  const batch = await visit(original, async (item, index) => {\n    counters.callbacks++;\n    const value = await lookup(item);\n    counters.total += value;\n    trace.push([batchIndex, index, item, value]);\n    const captured = value + batchIndex;\n    return { item, computed: captured + 1 };\n  });\n  result.push(batch.map((item) => [item.item, item.computed]));\n  await checkpoint("batch:" + batchIndex);\n}\nreturn { result, counters, trace };\n',
  scan: 'export default async fixture => {\n  const trace = [];\n  const scan = async (values, accumulator, seed, hasSeed, emitEach, label) => {\n    let hasState = hasSeed;\n    let state = seed;\n    const emissions = [];\n    try {\n      for (let index = 0; index < values.length; index++) {\n        const value = values[index];\n        await Promise.resolve();\n        if (hasState) state = await accumulator(state, value, index);\n        else { state = value; hasState = true; }\n        if (emitEach) emissions.push(state);\n      }\n      if (!emitEach && hasState) emissions.push(state);\n      return { state, emissions, hasState };\n    } finally {\n      trace.push(["closed", label, values.length, emitEach]);\n    }\n  };\n  const promiseAliases = [\n    fixture.primary === fixture.again,\n    fixture.primary === fixture.nested.promise,\n    fixture.remote === fixture.remoteAgain,\n    fixture.primary !== fixture.remote\n  ];\n  const initial = { balance: 0, names: [] };\n  let current = initial;\n  const processed = [];\n  const readState = () => ({ initialBalance: initial.balance, currentBalance: current.balance, processed: [...processed] });\n  const emissions = [];\n  const inputOutcomes = [];\n  trace.push(["boundary", "both-pending"]);\n  await boundary("both-pending");\n  for (const key of fixture.order) {\n    trace.push(["await", key]);\n    const pending = key === "left" ? fixture.primary : fixture.remote;\n    const alias = key === "left" ? fixture.again : fixture.remoteAgain;\n    const batch = await pending;\n    const sameHandle = await pending;\n    batch.observedBy = key;\n    const repeated = await alias;\n    inputOutcomes.push({ key, status: "fulfilled", same: batch === repeated, batch: batch.name, sameHandle: batch === sameHandle, markerVisible: repeated.observedBy === key });\n    trace.push(["fulfilled", key, batch.name, batch === repeated]);\n    const accumulated = await scan(batch.events, async (state, event, index) => {\n      const next = event.replace ? { balance: state.balance, names: [...state.names] } : state;\n      await Promise.resolve();\n      next.balance += event.delta;\n      next.names.push(event.name + ":" + index);\n      trace.push(["event", key, event.name, next.balance]);\n      return next;\n    }, current, true, true, key);\n    current = accumulated.state;\n    emissions.push(...accumulated.emissions);\n    processed.push(key);\n    const observed = readState();\n    trace.push(["closure", key, observed.initialBalance, observed.currentBalance, observed.processed.length]);\n    trace.push(["boundary", "after:" + key]);\n    await boundary("after:" + key);\n  }\n  const numericIndexes = [];\n  const numeric = await scan([3, 5, 8], async (state, value, index) => {\n    numericIndexes.push(index);\n    return state + value;\n  }, undefined, false, false, "numeric");\n  const emptySeeded = await scan([], async state => state, 19, true, false, "empty-seeded");\n  const emptyUnseeded = await scan([], async state => state, undefined, false, false, "empty-unseeded");\n  const emissionAliases = [];\n  for (let index = 1; index < emissions.length; index++) emissionAliases.push(emissions[index - 1] === emissions[index]);\n  return {\n    balance: current.balance,\n    names: current.names,\n    promiseAliases,\n    inputOutcomes,\n    closure: readState(),\n    emissionAliases,\n    emissionBalances: emissions.map(item => item.balance),\n    initialIsFirst: initial === emissions[0],\n    lastIsCurrent: current === emissions[emissions.length - 1],\n    numeric: numeric.emissions,\n    numericIndexes,\n    empty: [emptySeeded.emissions, emptyUnseeded.emissions, emptyUnseeded.hasState],\n    trace\n  };\n};\n'
} as const;

export const sourceFiles = [
  {
    path: "async-replay/examples/05-callback-checkpoint.js",
    sha256: "2c89d4b9263d5adef1d04d0c9cb034be894d537526b7d5e220addf6c5c8181b3",
    bytes: 695
  },
  {
    path: "async-replay/examples/06-pending-retry-map.js",
    sha256: "3cdc473443515b387d75392e3cb93d6d1e26ec8d79ed1c940d0179183a90c63a",
    bytes: 1034
  },
  {
    path: "async-replay/examples/09-callback-data-proof.js",
    sha256: "464e5059007e0c8970604ffdb90aec4663fa115f908a90f330ffe871b1a64611",
    bytes: 679
  },
  {
    path: "public-promise-recovery/01-public-input-scan.ajs",
    sha256: "94f71537e4d19ff33a45cb950607c4e1eec1922276f15825166e4658cc64e9ff",
    bytes: 3623
  },
  {
    path: "public-promise-adaptation/01-public-input-scan.ajs",
    sha256: "94f71537e4d19ff33a45cb950607c4e1eec1922276f15825166e4658cc64e9ff",
    bytes: 3623
  },
  {
    path: "public-promise-chain/01-public-input-scan.ajs",
    sha256: "94f71537e4d19ff33a45cb950607c4e1eec1922276f15825166e4658cc64e9ff",
    bytes: 3623
  }
] as const;

export const promiseProfiles = [
  {
    id: "prefulfilled",
    fixtureData: {
      order: ["left", "right"]
    },
    receipts: {
      left: {
        status: "fulfilled",
        value: {
          name: "left",
          events: [
            {
              name: "open",
              delta: 3
            },
            {
              name: "credit",
              delta: 5
            }
          ]
        }
      },
      right: {
        status: "fulfilled",
        value: {
          name: "right",
          events: [
            {
              name: "replace",
              delta: -2,
              replace: true
            },
            {
              name: "settle",
              delta: 7
            }
          ]
        }
      }
    },
    expected: {
      balance: 13,
      names: ["open:0", "credit:1", "replace:0", "settle:1"],
      promiseAliases: [true, true, true, true],
      inputOutcomes: [
        {
          key: "left",
          status: "fulfilled",
          same: true,
          batch: "left",
          sameHandle: true,
          markerVisible: true
        },
        {
          key: "right",
          status: "fulfilled",
          same: true,
          batch: "right",
          sameHandle: true,
          markerVisible: true
        }
      ],
      closure: {
        initialBalance: 8,
        currentBalance: 13,
        processed: ["left", "right"]
      },
      emissionAliases: [true, false, true],
      emissionBalances: [8, 8, 13, 13],
      initialIsFirst: true,
      lastIsCurrent: true,
      numeric: [16],
      numericIndexes: [1, 2],
      empty: [[19], [], false],
      trace: [
        ["boundary", "both-pending"],
        ["await", "left"],
        ["fulfilled", "left", "left", true],
        ["event", "left", "open", 3],
        ["event", "left", "credit", 8],
        ["closed", "left", 2, true],
        ["closure", "left", 8, 8, 1],
        ["boundary", "after:left"],
        ["await", "right"],
        ["fulfilled", "right", "right", true],
        ["event", "right", "replace", 6],
        ["event", "right", "settle", 13],
        ["closed", "right", 2, true],
        ["closure", "right", 8, 13, 2],
        ["boundary", "after:right"],
        ["closed", "numeric", 3, false],
        ["closed", "empty-seeded", 0, false],
        ["closed", "empty-unseeded", 0, false]
      ]
    },
    expectedCalls: ["both-pending", "after:left", "after:right"],
    expectedHostTrace: [
      ["ack", "input", "left", "fulfilled"],
      ["ack", "input", "right", "fulfilled"],
      ["call", "boundary", "both-pending"],
      ["ack", "boundary", "both-pending"],
      ["call", "boundary", "after:left"],
      ["ack", "boundary", "after:left"],
      ["call", "boundary", "after:right"],
      ["ack", "boundary", "after:right"]
    ],
    expectedUniqueCallerPromises: 2,
    expectedInputJournalRowsIfAliasesPreserved: 2,
    selectedBoundaries: ["both-pending", "after:left"]
  },
  {
    id: "pending",
    fixtureData: {
      order: ["left", "right"]
    },
    receipts: {
      left: {
        status: "fulfilled",
        value: {
          name: "left",
          events: [
            {
              name: "open",
              delta: 3
            },
            {
              name: "credit",
              delta: 5
            }
          ]
        }
      },
      right: {
        status: "fulfilled",
        value: {
          name: "right",
          events: [
            {
              name: "replace",
              delta: -2,
              replace: true
            },
            {
              name: "settle",
              delta: 7
            }
          ]
        }
      }
    },
    expected: {
      balance: 13,
      names: ["open:0", "credit:1", "replace:0", "settle:1"],
      promiseAliases: [true, true, true, true],
      inputOutcomes: [
        {
          key: "left",
          status: "fulfilled",
          same: true,
          batch: "left",
          sameHandle: true,
          markerVisible: true
        },
        {
          key: "right",
          status: "fulfilled",
          same: true,
          batch: "right",
          sameHandle: true,
          markerVisible: true
        }
      ],
      closure: {
        initialBalance: 8,
        currentBalance: 13,
        processed: ["left", "right"]
      },
      emissionAliases: [true, false, true],
      emissionBalances: [8, 8, 13, 13],
      initialIsFirst: true,
      lastIsCurrent: true,
      numeric: [16],
      numericIndexes: [1, 2],
      empty: [[19], [], false],
      trace: [
        ["boundary", "both-pending"],
        ["await", "left"],
        ["fulfilled", "left", "left", true],
        ["event", "left", "open", 3],
        ["event", "left", "credit", 8],
        ["closed", "left", 2, true],
        ["closure", "left", 8, 8, 1],
        ["boundary", "after:left"],
        ["await", "right"],
        ["fulfilled", "right", "right", true],
        ["event", "right", "replace", 6],
        ["event", "right", "settle", 13],
        ["closed", "right", 2, true],
        ["closure", "right", 8, 13, 2],
        ["boundary", "after:right"],
        ["closed", "numeric", 3, false],
        ["closed", "empty-seeded", 0, false],
        ["closed", "empty-unseeded", 0, false]
      ]
    },
    expectedCalls: ["both-pending", "after:left", "after:right"],
    expectedHostTrace: [
      ["call", "boundary", "both-pending"],
      ["ack", "boundary", "both-pending"],
      ["ack", "input", "left", "fulfilled"],
      ["call", "boundary", "after:left"],
      ["ack", "boundary", "after:left"],
      ["ack", "input", "right", "fulfilled"],
      ["call", "boundary", "after:right"],
      ["ack", "boundary", "after:right"]
    ],
    expectedUniqueCallerPromises: 2,
    expectedInputJournalRowsIfAliasesPreserved: 2,
    selectedBoundaries: ["both-pending", "after:left"]
  }
] as const;

export const asyncNativeAnchors = {
  "callback-external": {
    value: {
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
    ]
  },
  "retry-reissue": {
    value: {
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
    ]
  },
  "retry-external": {
    value: {
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
    ]
  },
  "callback-external-data": {
    value: {
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
    ]
  }
} as const;

export const lifecycleCases = [
  {
    id: "async-replay:/schedulerBoundaries/1",
    originalCaseId: "async-replay:05-callback-checkpoint::callback-external",
    group: "O05",
    scenario: "callback-external",
    sourceKey: "callbackFunction",
    originalPath: "async-replay/examples/05-callback-checkpoint.js",
    resultPointer: "/schedulerBoundaries/1",
    inputProfile: "ordinary",
    captureBoundary: "lookup:3",
    proofDelivery: "replayed-results-joined",
    callbackDisposition: "joined",
    expectedRemainingCalls: [
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
    id: "async-replay:/correctedBoundaries/0",
    originalCaseId: "async-replay:06-pending-retry-map::retry-reissue",
    group: "O05",
    scenario: "retry-reissue",
    sourceKey: "retry",
    originalPath: "async-replay/examples/06-pending-retry-map.js",
    resultPointer: "/correctedBoundaries/0",
    inputProfile: "ordinary",
    captureBoundary: "operation:c:1+operation:b:2",
    proofDelivery: "reissue",
    callbackDisposition: "not-applicable",
    expectedRemainingCalls: [
      ["operation", "c", 1, 5],
      ["operation", "b", 2, 3],
      ["checkpoint", "finished"]
    ]
  },
  {
    id: "async-replay:/correctedBoundaries/1",
    originalCaseId: "async-replay:06-pending-retry-map::retry-external",
    group: "O05",
    scenario: "retry-external",
    sourceKey: "retry",
    originalPath: "async-replay/examples/06-pending-retry-map.js",
    resultPointer: "/correctedBoundaries/1",
    inputProfile: "ordinary",
    captureBoundary: "operation:c:1+operation:b:2",
    proofDelivery: "b:2-before-c:1",
    callbackDisposition: "not-applicable",
    expectedRemainingCalls: [["checkpoint", "finished"]]
  },
  {
    id: "async-replay:/correctedBoundaries/3",
    originalCaseId: "async-replay:09-callback-data-proof::callback-external-data",
    group: "O05",
    scenario: "callback-external-data",
    sourceKey: "callbackData",
    originalPath: "async-replay/examples/09-callback-data-proof.js",
    resultPointer: "/correctedBoundaries/3",
    inputProfile: "ordinary",
    captureBoundary: "lookup:3",
    proofDelivery: "replayed-results-joined",
    callbackDisposition: "joined",
    expectedRemainingCalls: [
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
    id: "public-promise-recovery:pending-after-left-held-proofs",
    originalCaseId: "public-promise-recovery:pending-after-left-held-proofs",
    group: "O13",
    scenario: "pending-after-left-held-proofs",
    sourceKey: "scan",
    originalPath: "public-promise-recovery/01-public-input-scan.ajs",
    resultPointer: "/classifications/11",
    inputProfile: "pending",
    captureBoundary: "after:left",
    proofDelivery: "host-released-after-request",
    callbackDisposition: "not-applicable",
    expectedRemainingCalls: ["after:left", "after:right"],
    adapter: "raw-native-promises"
  },
  {
    id: "public-promise-recovery:pending-after-left-immediate-proofs",
    originalCaseId: "public-promise-recovery:pending-after-left-immediate-proofs",
    group: "O13",
    scenario: "pending-after-left-immediate-proofs",
    sourceKey: "scan",
    originalPath: "public-promise-recovery/01-public-input-scan.ajs",
    resultPointer: "/classifications/12",
    inputProfile: "pending",
    captureBoundary: "after:left",
    proofDelivery: "immediate-if-needed",
    callbackDisposition: "not-applicable",
    expectedRemainingCalls: ["after:left", "after:right"],
    adapter: "raw-native-promises"
  },
  {
    id: "public-promise-recovery:pending-both-pending-immediate-proofs",
    originalCaseId: "public-promise-recovery:pending-both-pending-immediate-proofs",
    group: "O13",
    scenario: "pending-both-pending-immediate-proofs",
    sourceKey: "scan",
    originalPath: "public-promise-recovery/01-public-input-scan.ajs",
    resultPointer: "/classifications/14",
    inputProfile: "pending",
    captureBoundary: "both-pending",
    proofDelivery: "immediate-if-needed",
    callbackDisposition: "not-applicable",
    expectedRemainingCalls: ["both-pending", "after:left", "after:right"],
    adapter: "raw-native-promises"
  },
  {
    id: "public-promise-recovery:pending-missing-provider",
    originalCaseId: "public-promise-recovery:pending-missing-provider",
    group: "O13",
    scenario: "pending-missing-provider",
    sourceKey: "scan",
    originalPath: "public-promise-recovery/01-public-input-scan.ajs",
    resultPointer: "/classifications/16",
    inputProfile: "pending",
    captureBoundary: "both-pending",
    proofDelivery: "missing",
    callbackDisposition: "not-applicable",
    expectedRemainingCalls: ["both-pending", "after:left", "after:right"],
    adapter: "raw-native-promises"
  },
  {
    id: "public-promise-adaptation:full-prefulfilled-after-left-restore",
    originalCaseId: "public-promise-adaptation:full-prefulfilled-after-left-restore",
    group: "O14",
    scenario: "full-prefulfilled-after-left-restore",
    sourceKey: "scan",
    originalPath: "public-promise-adaptation/01-public-input-scan.ajs",
    resultPointer: "/validation/10",
    inputProfile: "prefulfilled",
    captureBoundary: "after:left",
    proofDelivery: "immediate-if-needed",
    callbackDisposition: "not-applicable",
    expectedRemainingCalls: ["after:left", "after:right"],
    adapter: "public-deepCopyToSandbox-once-per-input-before-initial-run-only"
  },
  {
    id: "public-promise-adaptation:full-prefulfilled-both-pending-restore",
    originalCaseId: "public-promise-adaptation:full-prefulfilled-both-pending-restore",
    group: "O14",
    scenario: "full-prefulfilled-both-pending-restore",
    sourceKey: "scan",
    originalPath: "public-promise-adaptation/01-public-input-scan.ajs",
    resultPointer: "/validation/12",
    inputProfile: "prefulfilled",
    captureBoundary: "both-pending",
    proofDelivery: "immediate-if-needed",
    callbackDisposition: "not-applicable",
    expectedRemainingCalls: ["both-pending", "after:left", "after:right"],
    adapter: "public-deepCopyToSandbox-once-per-input-before-initial-run-only"
  },
  {
    id: "public-promise-chain:prefulfilled-resume-a",
    originalCaseId: "public-promise-chain:prefulfilled-resume-a",
    group: "O14",
    scenario: "prefulfilled-resume-a",
    sourceKey: "scan",
    originalPath: "public-promise-chain/01-public-input-scan.ajs",
    resultPointer: "/validation/6",
    inputProfile: "prefulfilled",
    captureBoundary: "both-pending",
    proofDelivery: "immediate-if-needed",
    callbackDisposition: "not-applicable",
    expectedRemainingCalls: ["both-pending", "after:left", "after:right"],
    adapter: "public-deepCopyToSandbox-once-per-input-before-initial-run-only"
  },
  {
    id: "public-promise-chain:prefulfilled-resume-b",
    originalCaseId: "public-promise-chain:prefulfilled-resume-b",
    group: "O14",
    scenario: "prefulfilled-resume-b",
    sourceKey: "scan",
    originalPath: "public-promise-chain/01-public-input-scan.ajs",
    resultPointer: "/validation/10",
    inputProfile: "prefulfilled",
    captureBoundary: "after:left",
    proofDelivery: "immediate-if-needed",
    callbackDisposition: "not-applicable",
    expectedRemainingCalls: ["after:left", "after:right"],
    adapter: "public-deepCopyToSandbox-once-per-input-before-initial-run-only"
  }
] as const;

export const proofSchedules = [
  {
    id: "async-replay:/schedulerBoundaries/1",
    capture: {
      sourceKey: "callbackFunction",
      boundary: "lookup:3",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "replayed-results-joined",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "joined",
      sourceOfTruth: "reconstructed saved callback results, never synthetic native functions",
      releaseCondition:
        "observe nested lookup:3 replay gate, release it from host; await context.replayed result promises without calling callbacks",
      completionNotEquivalentToProviderReturn: true,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "provider-invoked",
      "proof-returned",
      "source-progress",
      "proof-consumed-or-explicit-refusal",
      "completed"
    ],
    expectedRemainingCalls: [
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
    strictConsumedAnchor: false,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "async-replay:05-callback-checkpoint::callback-external",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  },
  {
    id: "async-replay:/correctedBoundaries/0",
    capture: {
      sourceKey: "retry",
      boundary: "operation:c:1+operation:b:2",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "reissue",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "not-applicable",
      sourceOfTruth:
        "No proof provider: pure modeled host operation reissues actual pending c/1 and b/2 invocations",
      releaseCondition:
        "Observe both reissued gates, release b/2=32, drain 32 microtasks, then release c/1=51",
      completionNotEquivalentToProviderReturn: true,
      providerExpected: false,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "pending-operations-reissued",
      "host-outcomes-delivered",
      "source-progress",
      "completed"
    ],
    expectedRemainingCalls: [
      ["operation", "c", 1, 5],
      ["operation", "b", 2, 3],
      ["checkpoint", "finished"]
    ],
    strictConsumedAnchor: false,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "async-replay:06-pending-retry-map::retry-reissue",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  },
  {
    id: "async-replay:/correctedBoundaries/1",
    capture: {
      sourceKey: "retry",
      boundary: "operation:c:1+operation:b:2",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "b:2-before-c:1",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "not-applicable",
      sourceOfTruth: "per-operation original invocation receipt; b/2=32, c/1=51",
      releaseCondition:
        "Match each actual pending request to its captured invocation receipt; host releases b/2=32 before c/1=51, separated by 32 microtasks; never wait for guest progress behind either held proof",
      completionNotEquivalentToProviderReturn: true,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "provider-invoked",
      "proof-returned",
      "source-progress",
      "proof-consumed-or-explicit-refusal",
      "completed"
    ],
    expectedRemainingCalls: [["checkpoint", "finished"]],
    strictConsumedAnchor: false,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "async-replay:06-pending-retry-map::retry-external",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  },
  {
    id: "async-replay:/correctedBoundaries/3",
    capture: {
      sourceKey: "callbackData",
      boundary: "lookup:3",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "replayed-results-joined",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "joined",
      sourceOfTruth: "reconstructed saved callback results, never synthetic native functions",
      releaseCondition:
        "observe nested lookup:3 replay gate, release it from host; await context.replayed result promises without calling callbacks",
      completionNotEquivalentToProviderReturn: true,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "provider-invoked",
      "proof-returned",
      "source-progress",
      "proof-consumed-or-explicit-refusal",
      "completed"
    ],
    expectedRemainingCalls: [
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
    strictConsumedAnchor: false,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "async-replay:09-callback-data-proof::callback-external-data",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  },
  {
    id: "public-promise-recovery:pending-after-left-held-proofs",
    capture: {
      sourceKey: "scan",
      boundary: "after:left",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "host-released-after-request",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "not-applicable",
      sourceOfTruth:
        "immutable fixture receipt copied before native delivery, matched through actual input operation path and alias graph",
      releaseCondition:
        "provider request observed; drain at most 32 microtasks then release proof from host regardless of guest state",
      completionNotEquivalentToProviderReturn: true,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "provider-invoked",
      "proof-returned",
      "source-progress",
      "proof-consumed-or-explicit-refusal",
      "completed"
    ],
    expectedRemainingCalls: ["after:left", "after:right"],
    strictConsumedAnchor: true,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "public-promise-recovery:pending-after-left-held-proofs",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  },
  {
    id: "public-promise-recovery:pending-after-left-immediate-proofs",
    capture: {
      sourceKey: "scan",
      boundary: "after:left",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "immediate-if-needed",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "not-applicable",
      sourceOfTruth:
        "immutable fixture receipt copied before native delivery, matched through actual input operation path and alias graph",
      releaseCondition:
        "all actual requested receipts are immediately available; missing-provider case omits provider entirely",
      completionNotEquivalentToProviderReturn: true,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "provider-invoked",
      "proof-returned",
      "source-progress",
      "proof-consumed-or-explicit-refusal",
      "completed"
    ],
    expectedRemainingCalls: ["after:left", "after:right"],
    strictConsumedAnchor: true,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "public-promise-recovery:pending-after-left-immediate-proofs",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  },
  {
    id: "public-promise-recovery:pending-both-pending-immediate-proofs",
    capture: {
      sourceKey: "scan",
      boundary: "both-pending",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "immediate-if-needed",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "not-applicable",
      sourceOfTruth:
        "immutable fixture receipt copied before native delivery, matched through actual input operation path and alias graph",
      releaseCondition:
        "all actual requested receipts are immediately available; missing-provider case omits provider entirely",
      completionNotEquivalentToProviderReturn: true,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "provider-invoked",
      "proof-returned",
      "source-progress",
      "proof-consumed-or-explicit-refusal",
      "completed"
    ],
    expectedRemainingCalls: ["both-pending", "after:left", "after:right"],
    strictConsumedAnchor: true,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "public-promise-recovery:pending-both-pending-immediate-proofs",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  },
  {
    id: "public-promise-recovery:pending-missing-provider",
    capture: {
      sourceKey: "scan",
      boundary: "both-pending",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "missing",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "not-applicable",
      sourceOfTruth:
        "immutable fixture receipt copied before native delivery, matched through actual input operation path and alias graph",
      releaseCondition:
        "all actual requested receipts are immediately available; missing-provider case omits provider entirely",
      completionNotEquivalentToProviderReturn: true,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "provider-invoked",
      "proof-returned",
      "source-progress",
      "proof-consumed-or-explicit-refusal",
      "completed"
    ],
    expectedRemainingCalls: ["both-pending", "after:left", "after:right"],
    strictConsumedAnchor: true,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "public-promise-recovery:pending-missing-provider",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  },
  {
    id: "public-promise-adaptation:full-prefulfilled-after-left-restore",
    capture: {
      sourceKey: "scan",
      boundary: "after:left",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "immediate-if-needed",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "not-applicable",
      sourceOfTruth:
        "immutable fixture receipt copied before native delivery, matched through actual input operation path and alias graph",
      releaseCondition:
        "all actual requested receipts are immediately available; missing-provider case omits provider entirely",
      completionNotEquivalentToProviderReturn: true,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "provider-invoked",
      "proof-returned",
      "source-progress",
      "proof-consumed-or-explicit-refusal",
      "completed"
    ],
    expectedRemainingCalls: ["after:left", "after:right"],
    strictConsumedAnchor: true,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "public-promise-adaptation:full-prefulfilled-after-left-restore",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  },
  {
    id: "public-promise-adaptation:full-prefulfilled-both-pending-restore",
    capture: {
      sourceKey: "scan",
      boundary: "both-pending",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "immediate-if-needed",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "not-applicable",
      sourceOfTruth:
        "immutable fixture receipt copied before native delivery, matched through actual input operation path and alias graph",
      releaseCondition:
        "all actual requested receipts are immediately available; missing-provider case omits provider entirely",
      completionNotEquivalentToProviderReturn: true,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "provider-invoked",
      "proof-returned",
      "source-progress",
      "proof-consumed-or-explicit-refusal",
      "completed"
    ],
    expectedRemainingCalls: ["both-pending", "after:left", "after:right"],
    strictConsumedAnchor: true,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "public-promise-adaptation:full-prefulfilled-both-pending-restore",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  },
  {
    id: "public-promise-chain:prefulfilled-resume-a",
    capture: {
      sourceKey: "scan",
      boundary: "both-pending",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "immediate-if-needed",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "not-applicable",
      sourceOfTruth:
        "immutable fixture receipt copied before native delivery, matched through actual input operation path and alias graph",
      releaseCondition:
        "all actual requested receipts are immediately available; missing-provider case omits provider entirely",
      completionNotEquivalentToProviderReturn: true,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "provider-invoked",
      "proof-returned",
      "source-progress",
      "proof-consumed-or-explicit-refusal",
      "completed"
    ],
    expectedRemainingCalls: ["both-pending", "after:left", "after:right"],
    strictConsumedAnchor: true,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "public-promise-chain:prefulfilled-resume-a",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  },
  {
    id: "public-promise-chain:prefulfilled-resume-b",
    capture: {
      sourceKey: "scan",
      boundary: "after:left",
      requireActualSerializedSnapshot: true,
      noRestoreOnCaptureFailure: true
    },
    proof: {
      delivery: "immediate-if-needed",
      identityFields: ["callId", "sourceHash", "moduleId", "operation", "argumentDigest"],
      callbackDisposition: "not-applicable",
      sourceOfTruth:
        "immutable fixture receipt copied before native delivery, matched through actual input operation path and alias graph",
      releaseCondition:
        "all actual requested receipts are immediately available; missing-provider case omits provider entirely",
      completionNotEquivalentToProviderReturn: true,
      releaseIndependentOfGuestProgress: true
    },
    observationStages: [
      "capture-requested",
      "capture-succeeded-or-failed",
      "provider-invoked",
      "proof-returned",
      "source-progress",
      "proof-consumed-or-explicit-refusal",
      "completed"
    ],
    expectedRemainingCalls: ["after:left", "after:right"],
    strictConsumedAnchor: true,
    freshProcessRequiredAfterFreeze: true,
    originalCaseId: "public-promise-chain:prefulfilled-resume-b",
    bounds: {
      microtaskTurnsPerNotification: 8192,
      heldObservationTurns: 32,
      childWatchdogMs: 7500,
      parentTimeoutMs: 10000,
      childHeapMiB: 192,
      maxSteps: 75000
    }
  }
] as const;

export const callbackDispositionControls = [
  {
    id: "synthetic-disposition-joined",
    source:
      'const trace = [];\nconst hostResult = await start(async () => {\n  await callbackGate();\n  trace.push("callback");\n  return 7;\n});\ntrace.push("host-result");\nawait finishGate();\nreturn { hostResult, trace };\n',
    callbackDisposition: "joined",
    expected: {
      hostResult: {
        value: 7
      },
      trace: ["callback", "host-result"]
    },
    proofSource:
      "Outcome from actual completed original start invocation; not an invented callback result.",
    schedule: [
      "observe start and callbackGate pending",
      "capture actual start record before hostResultGate release",
      "release hostResultGate independently of callback",
      "joined waits; detached reaches finishGate before callbackGate release",
      "release callbackGate from host",
      "observe finishGate",
      "release finishGate"
    ]
  },
  {
    id: "synthetic-disposition-detached",
    source:
      'const trace = [];\nconst hostResult = await start(async () => {\n  await callbackGate();\n  trace.push("callback");\n  return 7;\n});\ntrace.push("host-result");\nawait finishGate();\nreturn { hostResult, trace };\n',
    callbackDisposition: "detached",
    expected: {
      hostResult: {
        value: 7
      },
      trace: ["host-result", "callback"]
    },
    proofSource:
      "Outcome from actual completed original start invocation; not an invented callback result.",
    schedule: [
      "observe start and callbackGate pending",
      "capture actual start record before hostResultGate release",
      "release hostResultGate independently of callback",
      "joined waits; detached reaches finishGate before callbackGate release",
      "release callbackGate from host",
      "observe finishGate",
      "release finishGate"
    ]
  }
] as const;
