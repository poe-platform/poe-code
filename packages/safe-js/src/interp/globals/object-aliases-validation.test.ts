import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { deepCopyFromSandbox, deepCopyToSandbox, isSandboxClosure } from "../values.js";
import { createObjectArrayGlobals } from "./object-array.js";

const limits = {
  maxSteps: 20000,
  maxCallDepth: 48,
  stringLength: 16384,
  arrayLength: 512,
  dataSize: 500000
};

const originalSources = {
  projection: `function projectPaths(source, paths) {
  const result = {};
  for (const path of paths) {
    let value = source;
    let found = true;
    for (const key of path) {
      if (value === null || value === undefined || !Object.hasOwn(value, key)) {
        found = false;
        break;
      }
      value = value[key];
    }
    if (!found) continue;
    let destination = result;
    for (let index = 0; index < path.length; index++) {
      const key = path[index];
      if (key === "__proto__" || key === "constructor" || key === "prototype") break;
      if (index === path.length - 1) {
        destination[key] = value;
      } else {
        if (!Object.hasOwn(destination, key)) {
          destination[key] = typeof path[index + 1] === "number" ? [] : {};
        }
        destination = destination[key];
      }
    }
  }
  return result;
}

const shared = { level: 3 };
const source = { users: [{ name: "Ada", settings: shared }, { name: "Lin", settings: shared }], meta: { missing: undefined, version: 2 } };
const paths = [["users", 0, "settings"], ["users", 1, "settings"], ["users", 1, "name"], ["meta", "missing"], ["absent", "child"]];
const projected = projectPaths(source, paths);
const entries = Object.entries(projected);
const rebuilt = Object.fromEntries(entries);
const values = Object.values(projected);
if (caseName === "mutate-entries") entries[0][1][0].settings.level = 11;
return {
  json: JSON.stringify(projected),
  nestedAlias: projected.users[0].settings === projected.users[1].settings,
  sourceAlias: projected.users[0].settings === shared,
  entriesIdentity: entries[0][1] === projected.users,
  valuesIdentity: values[0] === projected.users,
  rebuiltIdentity: rebuilt.users === projected.users,
  rebuiltMetaIdentity: rebuilt.meta === projected.meta,
  missingOwn: Object.hasOwn(rebuilt.meta, "missing"),
  sourceLevel: shared.level,
  absentSkipped: !Object.hasOwn(projected, "absent")
};
`,
  identity: `const shared = { count: 1 };
const source = { first: shared, second: shared };
const result = caseName === "entries" ? Object.entries(source)[0][1]
  : caseName === "values" ? Object.values(source)[0]
  : Object.fromEntries([["first", shared]]).first;
result.count = 2;
return { same: result === shared, sourceCount: shared.count, resultCount: result.count };
`,
  pairs: `const shared = { count: 1, nested: { score: 5 } };
const firstPair = ["first", shared];
const secondPair = ["second", shared];
const pairs = [firstPair, secondPair];
const pairArrayPreservesPair = pairs[0] === firstPair;
const inputMatchesSource = pairs[0][1] === shared;
const inputValuesAlias = pairs[0][1] === pairs[1][1];
const rebuilt = Object.fromEntries(pairs);
const outputMatchesInput = rebuilt.first === pairs[0][1];
const outputMatchesSource = rebuilt.first === shared;
const outputValuesAlias = rebuilt.first === rebuilt.second;
rebuilt.first.count = 7;
rebuilt.second.nested.score = 9;
return {
  pairArrayPreservesPair,
  inputMatchesSource,
  inputValuesAlias,
  outputMatchesInput,
  outputMatchesSource,
  outputValuesAlias,
  sourceCount: shared.count,
  pairCount: pairs[0][1].count,
  outputCount: rebuilt.second.count,
  sourceNestedScore: shared.nested.score,
  pairNestedScore: pairs[1][1].nested.score,
  outputNestedScore: rebuilt.first.nested.score
};
`,
  duplicates: `const first = { count: 2 };
const last = { count: 4 };
const pairs = [["chosen", first], ["original", first], ["chosen", last], ["alias", last]];
const inputFirstMatches = pairs[0][1] === first && pairs[1][1] === first;
const inputLastMatches = pairs[2][1] === last && pairs[3][1] === last;
const rebuilt = Object.fromEntries(pairs);
const chosenBefore = rebuilt.chosen.count;
const originalBefore = rebuilt.original.count;
const chosenMatchesLastInput = rebuilt.chosen === pairs[2][1];
const originalMatchesFirstInput = rebuilt.original === pairs[1][1];
const outputLastAlias = rebuilt.chosen === rebuilt.alias;
const overwrittenIsDistinct = rebuilt.chosen !== rebuilt.original;
rebuilt.chosen.count = 12;
rebuilt.original.count = 6;
return {
  inputFirstMatches,
  inputLastMatches,
  chosenBefore,
  originalBefore,
  chosenMatchesLastInput,
  originalMatchesFirstInput,
  outputLastAlias,
  overwrittenIsDistinct,
  firstCount: first.count,
  lastCount: last.count,
  firstInputCount: pairs[0][1].count,
  lastInputCount: pairs[3][1].count,
  chosenCount: rebuilt.chosen.count,
  aliasCount: rebuilt.alias.count,
  originalCount: rebuilt.original.count
};
`,
  arrays: `const shared = { count: 3 };
const values = [shared, shared];
const pairs = [["list", values], ["owner", shared]];
const literalValuesAlias = values[0] === shared && values[1] === shared;
const pairPreservesArray = pairs[0][1] === values;
const pairPreservesRecord = pairs[1][1] === shared;
const rebuilt = Object.fromEntries(pairs);
const outputPreservesArray = rebuilt.list === values;
const outputPreservesRecord = rebuilt.owner === shared;
const outputNestedAlias = rebuilt.list[0] === rebuilt.owner && rebuilt.list[1] === rebuilt.owner;
rebuilt.list[1].count = 8;
return {
  literalValuesAlias,
  pairPreservesArray,
  pairPreservesRecord,
  outputPreservesArray,
  outputPreservesRecord,
  outputNestedAlias,
  sourceCount: shared.count,
  literalArrayCount: values[0].count,
  pairArrayCount: pairs[0][1][1].count,
  outputArrayCount: rebuilt.list[0].count,
  outputOwnerCount: rebuilt.owner.count
};
`
};

const originalCases = [
  {
    ...{
      id: "pick-transform",
      file: "objects/lodash-pick-transform.ajs",
      caseName: "normal",
      expected: {
        json: '{"users":[{"settings":{"level":3}},{"settings":{"level":3},"name":"Lin"}],"meta":{}}',
        nestedAlias: true,
        sourceAlias: true,
        entriesIdentity: true,
        valuesIdentity: true,
        rebuiltIdentity: true,
        rebuiltMetaIdentity: true,
        missingOwn: true,
        sourceLevel: 3,
        absentSkipped: true
      },
      sha256: "88f57dd8bb7d8be5c70ec72c9f91a86569009bbc48aaf019698dccb806488200"
    },
    code: originalSources.projection
  },
  {
    ...{
      id: "pick-transform-mutate",
      file: "objects/lodash-pick-transform.ajs",
      caseName: "mutate-entries",
      expected: {
        json: '{"users":[{"settings":{"level":11}},{"settings":{"level":11},"name":"Lin"}],"meta":{}}',
        nestedAlias: true,
        sourceAlias: true,
        entriesIdentity: true,
        valuesIdentity: true,
        rebuiltIdentity: true,
        rebuiltMetaIdentity: true,
        missingOwn: true,
        sourceLevel: 11,
        absentSkipped: true
      },
      sha256: "88f57dd8bb7d8be5c70ec72c9f91a86569009bbc48aaf019698dccb806488200"
    },
    code: originalSources.projection
  },
  {
    ...{
      id: "identity-entries",
      file: "objects/reductions/object-identity.ajs",
      caseName: "entries",
      expected: { same: true, sourceCount: 2, resultCount: 2 },
      sha256: "5fbac60d72c518d51198e1a38442ed4531b174f980e38d490c7f9151c94b995f"
    },
    code: originalSources.identity
  },
  {
    ...{
      id: "identity-values",
      file: "objects/reductions/object-identity.ajs",
      caseName: "values",
      expected: { same: true, sourceCount: 2, resultCount: 2 },
      sha256: "5fbac60d72c518d51198e1a38442ed4531b174f980e38d490c7f9151c94b995f"
    },
    code: originalSources.identity
  },
  {
    ...{
      id: "identity-from-entries",
      file: "objects/reductions/object-identity.ajs",
      caseName: "fromEntries",
      expected: { same: true, sourceCount: 2, resultCount: 2 },
      sha256: "5fbac60d72c518d51198e1a38442ed4531b174f980e38d490c7f9151c94b995f"
    },
    code: originalSources.identity
  },
  {
    ...{
      id: "FE01",
      file: "from-entries-alias-review/originals/lodash-pick-transform.ajs",
      caseName: "mutate-entries",
      expected: {
        json: '{"users":[{"settings":{"level":11}},{"settings":{"level":11},"name":"Lin"}],"meta":{}}',
        nestedAlias: true,
        sourceAlias: true,
        entriesIdentity: true,
        valuesIdentity: true,
        rebuiltIdentity: true,
        rebuiltMetaIdentity: true,
        missingOwn: true,
        sourceLevel: 11,
        absentSkipped: true
      },
      sha256: "88f57dd8bb7d8be5c70ec72c9f91a86569009bbc48aaf019698dccb806488200"
    },
    code: originalSources.projection
  },
  {
    ...{
      id: "FE02",
      file: "from-entries-alias-review/reductions/02-direct-shared-pairs.ajs",
      expected: {
        pairArrayPreservesPair: true,
        inputMatchesSource: true,
        inputValuesAlias: true,
        outputMatchesInput: true,
        outputMatchesSource: true,
        outputValuesAlias: true,
        sourceCount: 7,
        pairCount: 7,
        outputCount: 7,
        sourceNestedScore: 9,
        pairNestedScore: 9,
        outputNestedScore: 9
      },
      sha256: "8b4a92ad3c4046bd6a63a08d82ffaf6b55267e95197483c51c876c9b40c52eed"
    },
    code: originalSources.pairs
  },
  {
    ...{
      id: "FE03",
      file: "from-entries-alias-review/reductions/03-duplicate-key-references.ajs",
      expected: {
        inputFirstMatches: true,
        inputLastMatches: true,
        chosenBefore: 4,
        originalBefore: 2,
        chosenMatchesLastInput: true,
        originalMatchesFirstInput: true,
        outputLastAlias: true,
        overwrittenIsDistinct: true,
        firstCount: 6,
        lastCount: 12,
        firstInputCount: 6,
        lastInputCount: 12,
        chosenCount: 12,
        aliasCount: 12,
        originalCount: 6
      },
      sha256: "9487528be21f8a6c718911243a4e450fd978884bf52f9dec6c50ee767686c436"
    },
    code: originalSources.duplicates
  },
  {
    ...{
      id: "FE04",
      file: "from-entries-alias-review/reductions/04-array-contained-alias.ajs",
      expected: {
        literalValuesAlias: true,
        pairPreservesArray: true,
        pairPreservesRecord: true,
        outputPreservesArray: true,
        outputPreservesRecord: true,
        outputNestedAlias: true,
        sourceCount: 8,
        literalArrayCount: 8,
        pairArrayCount: 8,
        outputArrayCount: 8,
        outputOwnerCount: 8
      },
      sha256: "22aabcbff8712004c1416e05c5c93ad8d8fcf6bc207208c00916f473ceb6fc58"
    },
    code: originalSources.arrays
  }
];

describe("OBJ-001 independent validation", () => {
  it.each(originalCases)(
    "replays original $id against its full immutable anchor",
    async (entry) => {
      expect(createHash("sha256").update(entry.code).digest("hex")).toBe(entry.sha256);
      const caseName = "caseName" in entry ? entry.caseName : undefined;
      expect(new Function("caseName", entry.code)(caseName)).toEqual(entry.expected);
      const result = await run(entry.code, {
        bindings: caseName === undefined ? {} : { caseName },
        budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Original alias workflow failed");
      expect(result.returnValue).toEqual(entry.expected);
    }
  );
  it.each([
    {
      method: "entries",
      shape: "record",
      source: "{ first: shared, second: nested }",
      first: "first",
      second: "second"
    },
    {
      method: "values",
      shape: "record",
      source: "{ first: shared, second: nested }",
      first: "first",
      second: "second"
    },
    { method: "entries", shape: "array", source: "[shared, nested]", first: "0", second: "1" },
    { method: "values", shape: "array", source: "[shared, nested]", first: "0", second: "1" }
  ])(
    "keeps $method references but snapshots $shape membership on each call",
    async ({ method, shape, source, first, second }) => {
      const code = `
      const shared = { count: 2 };
      const nested = [shared];
      const source = ${source};
      const before = [source["${first}"] === shared, source["${second}"] === nested, nested[0] === shared];
      const captured = Object.${method}(source);
      const repeated = Object.${method}(source);
      const record = ${method === "entries" ? "captured[0][1]" : "captured[0]"};
      const list = ${method === "entries" ? "captured[1][1]" : "captured[1]"};
      const after = [record === shared, list === nested, list[0] === record, captured !== repeated];
      shared.count = 5;
      const sourceMutation = [record.count, list[0].count];
      record.count = 8;
      list.push({ count: 9 });
      const resultMutation = [source["${first}"].count, source["${second}"].length];
      source["${first}"] = { count: 99 };
      source["${second}"] = [];
      ${shape === "array" ? "source.push({ count: 100 });" : "source.added = { count: 100 }; delete source.second;"}
      const snapshot = [captured.length, record.count, list.length];
      ${method === "entries" ? 'captured[0][0] = "renamed"; captured[0][1] = { count: 4 };' : "captured[0] = { count: 4 };"}
      captured.push(null);
      const independent = [repeated.length, ${method === "entries" ? "repeated[0][0], repeated[0][1].count" : '"' + first + '", repeated[0].count'}, source["${first}"].count];
      return { before, after, sourceMutation, resultMutation, snapshot, independent };
    `;
      const expected = {
        before: [true, true, true],
        after: [true, true, true, true],
        sourceMutation: [5, 5],
        resultMutation: [8, 2],
        snapshot: [2, 8, 2],
        independent: [2, first, 8, 99]
      };
      expect(new Function(code)()).toEqual(expected);
      const result = await run(code, {
        budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Independent alias workflow failed");
      expect(result.returnValue).toEqual(expected);
    }
  );

  it("isolates manual pairs, last duplicate selection, and later replacement in both directions", async () => {
    const code = `
      const first = { count: 2 };
      const last = { count: 4 };
      const list = [last, last];
      const selectedPair = ["chosen", last];
      const pairs = [["chosen", first], ["first", first], selectedPair, ["list", list], ["alias", last]];
      const before = [pairs[2] === selectedPair, selectedPair[1] === last, pairs[0][1] === first, pairs[3][1] === list, list[1] === last];
      const output = Object.fromEntries(pairs);
      const repeated = Object.fromEntries(pairs);
      const after = [output !== repeated, output.chosen === last, output.first === first, output.alias === output.chosen, output.list === list, output.list[0] === last, output.chosen !== output.first];
      last.count = 6;
      const sourceMutation = [output.chosen.count, output.alias.count, output.list[1].count];
      output.list[0].count = 9;
      output.first.count = 7;
      const resultMutation = [last.count, selectedPair[1].count, first.count, pairs[0][1].count];
      selectedPair[0] = "renamed";
      selectedPair[1] = first;
      pairs[3][1] = [];
      pairs.push(["later", first]);
      const keys = Object.keys(output);
      const retained = [output.chosen === last, output.list === list, output.chosen.count, output.first.count];
      output.alias = first;
      delete output.first;
      output.extra = last;
      return { before, after, sourceMutation, resultMutation, keys, retained,
        inputUnaffected: [pairs[4][1] === last, pairs[1][1] === first, pairs.length],
        otherResult: [Object.keys(repeated), repeated.alias === last, repeated.first === first] };
    `;
    const expected = {
      before: [true, true, true, true, true],
      after: [true, true, true, true, true, true, true],
      sourceMutation: [6, 6, 6],
      resultMutation: [9, 9, 7, 7],
      keys: ["chosen", "first", "list", "alias"],
      retained: [true, true, 9, 7],
      inputUnaffected: [true, true, 6],
      otherResult: [["chosen", "first", "list", "alias"], true, true]
    };
    expect(new Function(code)()).toEqual(expected);
    const result = await run(code, {
      budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Independent alias workflow failed");
    expect(result.returnValue).toEqual(expected);
  });

  it.each([
    { expression: "structuredClone(source)", sharedInsideCopy: true },
    { expression: "JSON.parse(JSON.stringify(source))", sharedInsideCopy: false }
  ])(
    "preserves the intentional $expression copy boundary",
    async ({ expression, sharedInsideCopy }) => {
      const code = `
      const shared = { count: 2 };
      const source = { left: shared, right: shared };
      const copy = ${expression};
      const before = [copy !== source, copy.left !== source.left, copy.left === copy.right];
      const entries = Object.entries(copy);
      const values = Object.values(copy);
      const rebuilt = Object.fromEntries([["left", copy.left], ["right", copy.right]]);
      const localAliases = [entries[0][1] === copy.left, values[0] === copy.left, rebuilt.left === copy.left];
      rebuilt.left.count = 11;
      shared.count = 5;
      return { before, localAliases, counts: [source.left.count, source.right.count, copy.left.count, copy.right.count] };
    `;
      const expected = {
        before: [true, true, sharedInsideCopy],
        localAliases: [true, true, true],
        counts: [5, 5, 11, sharedInsideCopy ? 11 : 2]
      };
      expect(new Function(code)()).toEqual(expected);
      const result = await run(code, {
        budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Independent alias workflow failed");
      expect(result.returnValue).toEqual(expected);
    }
  );

  it("copies ordinary caller bindings independently across guest runs", async () => {
    const shared = { count: 3 };
    const input = { left: shared, right: shared };
    const code = `
      const before = [input.left === input.right, input.left.count];
      const rebuilt = Object.fromEntries(Object.entries(input));
      const values = Object.values(rebuilt);
      const localAliases = [rebuilt.left === input.left, values[1] === input.right];
      values[0].count = 12;
      return { before, localAliases, counts: [input.left.count, input.right.count, rebuilt.right.count] };
    `;
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const result = await run(code, {
        bindings: { input },
        budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Independent alias workflow failed");
      expect(result.returnValue).toEqual({
        before: [true, 3],
        localAliases: [true, true],
        counts: [12, 12, 12]
      });
      expect(shared.count).toBe(3);
      expect(input.left).toBe(input.right);
    }
  });

  it("keeps host module arguments and results detached while guest aliases survive", async () => {
    const hostValue = { count: 3 };
    const received: Array<{ left: { count: number }; right: { count: number } }> = [];
    const result = await run(
      `
        import { provide, exchange } from "ordinary";
        const shared = provide();
        const source = { left: shared, right: shared };
        const transformed = Object.fromEntries(Object.entries(source));
        const before = [transformed.left === shared, transformed.right === shared];
        transformed.left.count = 8;
        const returned = exchange(transformed);
        const after = [shared.count, returned.left.count, returned.left !== shared, returned.left === returned.right];
        returned.left.count = 20;
        return { before, after, final: [shared.count, returned.right.count] };
      `,
      {
        modules: {
          ordinary: {
            provide: () => hostValue,
            exchange: (value: { left: { count: number }; right: { count: number } }) => {
              expect(value.left).toBe(value.right);
              expect(value.left.count).toBe(8);
              received.push(value);
              value.left.count = 13;
              return value;
            }
          }
        },
        budget: new Budget({ ...limits, deadline: Date.now() + 2000 })
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Independent alias workflow failed");
    expect(result.returnValue).toEqual({
      before: [true, true],
      after: [8, 13, true, true],
      final: [8, 20]
    });
    expect(hostValue.count).toBe(3);
    expect(received).toHaveLength(1);
    expect(received[0].left.count).toBe(13);
    expect(received[0].left).not.toBe(hostValue);
  });

  it("keeps explicit host copy helpers detached after reference-preserving transforms", async () => {
    const hostRecord = { count: 2 };
    const hostInput = { left: hostRecord, right: hostRecord };
    const guestInput = deepCopyToSandbox(hostInput);
    const globals = createObjectArrayGlobals({ budget: new Budget(limits) });
    const entries = globals.Object.properties!.entries;
    const fromEntries = globals.Object.properties!.fromEntries;
    if (!isSandboxClosure(entries) || !isSandboxClosure(fromEntries))
      throw new Error("Missing Object transforms");
    const rebuilt = await fromEntries.call([await entries.call([guestInput])]);
    const firstCopy = deepCopyFromSandbox(rebuilt) as typeof hostInput;
    const secondCopy = deepCopyFromSandbox(rebuilt) as typeof hostInput;
    expect(Object.getPrototypeOf(rebuilt)).toBeNull();
    expect(firstCopy.left).toBe(firstCopy.right);
    expect(secondCopy.left).toBe(secondCopy.right);
    expect(firstCopy.left).not.toBe(hostRecord);
    expect(firstCopy.left).not.toBe(secondCopy.left);
    firstCopy.left.count = 11;
    hostRecord.count = 17;
    expect(firstCopy.right.count).toBe(11);
    expect(secondCopy.left.count).toBe(2);
    expect(deepCopyFromSandbox(rebuilt)).toEqual({ left: { count: 2 }, right: { count: 2 } });
  });
});
