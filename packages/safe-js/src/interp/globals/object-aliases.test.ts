import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { run } from "../../run.js";
import { Budget, SandboxError } from "../budget.js";
import { isSandboxClosure } from "../values.js";
import { createObjectArrayGlobals } from "./object-array.js";

const projectionSource = `function projectPaths(source, paths) {
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
`;

const identitySource = `const shared = { count: 1 };
const source = { first: shared, second: shared };
const result = caseName === "entries" ? Object.entries(source)[0][1]
  : caseName === "values" ? Object.values(source)[0]
  : Object.fromEntries([["first", shared]]).first;
result.count = 2;
return { same: result === shared, sourceCount: shared.count, resultCount: result.count };
`;

const sharedPairsSource = `const shared = { count: 1, nested: { score: 5 } };
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
`;

const duplicateKeysSource = `const first = { count: 2 };
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
`;

const arrayAliasSource = `const shared = { count: 3 };
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
`;

const originalCases = [
  {
    id: "pick-transform",
    code: projectionSource,
    caseName: "normal",
    sourceSha256: "88f57dd8bb7d8be5c70ec72c9f91a86569009bbc48aaf019698dccb806488200",
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
    }
  },
  {
    id: "pick-transform-mutate",
    code: projectionSource,
    caseName: "mutate-entries",
    sourceSha256: "88f57dd8bb7d8be5c70ec72c9f91a86569009bbc48aaf019698dccb806488200",
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
    }
  },
  {
    id: "identity-entries",
    code: identitySource,
    caseName: "entries",
    sourceSha256: "5fbac60d72c518d51198e1a38442ed4531b174f980e38d490c7f9151c94b995f",
    expected: {
      same: true,
      sourceCount: 2,
      resultCount: 2
    }
  },
  {
    id: "identity-values",
    code: identitySource,
    caseName: "values",
    sourceSha256: "5fbac60d72c518d51198e1a38442ed4531b174f980e38d490c7f9151c94b995f",
    expected: {
      same: true,
      sourceCount: 2,
      resultCount: 2
    }
  },
  {
    id: "identity-from-entries",
    code: identitySource,
    caseName: "fromEntries",
    sourceSha256: "5fbac60d72c518d51198e1a38442ed4531b174f980e38d490c7f9151c94b995f",
    expected: {
      same: true,
      sourceCount: 2,
      resultCount: 2
    }
  },
  {
    id: "FE01",
    code: projectionSource,
    caseName: "mutate-entries",
    sourceSha256: "88f57dd8bb7d8be5c70ec72c9f91a86569009bbc48aaf019698dccb806488200",
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
    }
  },
  {
    id: "FE02",
    code: sharedPairsSource,
    caseName: undefined,
    sourceSha256: "8b4a92ad3c4046bd6a63a08d82ffaf6b55267e95197483c51c876c9b40c52eed",
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
    }
  },
  {
    id: "FE03",
    code: duplicateKeysSource,
    caseName: undefined,
    sourceSha256: "9487528be21f8a6c718911243a4e450fd978884bf52f9dec6c50ee767686c436",
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
    }
  },
  {
    id: "FE04",
    code: arrayAliasSource,
    caseName: undefined,
    sourceSha256: "22aabcbff8712004c1416e05c5c93ad8d8fcf6bc207208c00916f473ceb6fc58",
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
    }
  }
];

describe("OBJ-001 source-local Object transform aliases", () => {
  it.each([
    {
      method: "entries",
      source: "{ first: shared, second: nested }",
      firstKey: "first",
      secondKey: "second"
    },
    {
      method: "values",
      source: "{ first: shared, second: nested }",
      firstKey: "first",
      secondKey: "second"
    },
    { method: "entries", source: "[shared, nested]", firstKey: "0", secondKey: "1" },
    { method: "values", source: "[shared, nested]", firstKey: "0", secondKey: "1" }
  ])(
    "keeps $method shallow but snapshots the outer result for $source",
    async ({ method, source, firstKey, secondKey }) => {
      const code = `
      const shared = { count: 1 };
      const nested = [shared];
      const source = ${source};
      const captured = Object.${method}(source);
      const direct = ${method === "entries" ? "captured[0][1]" : "captured[0]"};
      const list = ${method === "entries" ? "captured[1][1]" : "captured[1]"};
      const preCallAliases = source["${firstKey}"] === shared && source["${secondKey}"] === nested;
      const preserved = direct === shared && list === nested && list[0] === shared;
      direct.count = 7;
      const sourceCountAfterMutation = source["${firstKey}"].count;
      nested.push({ count: 2 });
      source["${firstKey}"] = { count: 20 };
      source["${secondKey}"] = [];
      source.extra = "later";
      const lengthBeforeEdit = captured.length;
      ${method === "entries" ? 'captured[0][0] = "renamed"; captured[0][1] = { count: 30 };' : "captured[0] = { count: 30 };"}
      captured.push("outer-only");
      return {
        preCallAliases,
        preserved,
        sourceCountAfterMutation,
        nestedLength: list.length,
        sharedCount: shared.count,
        sourceCount: source["${firstKey}"].count,
        snapshotCount: direct.count,
        lengthBeforeEdit,
        sourceHasRenamed: Object.hasOwn(source, "renamed"),
        freshOuter: captured !== Object.${method}(source)
      };
    `;
      const expected = {
        preCallAliases: true,
        preserved: true,
        sourceCountAfterMutation: 7,
        nestedLength: 2,
        sharedCount: 7,
        sourceCount: 20,
        snapshotCount: 7,
        lengthBeforeEdit: 2,
        sourceHasRenamed: false,
        freshOuter: true
      };
      expect(new Function(code)()).toEqual(expected);
      const result = await run(code);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Snapshot workflow did not complete");
      expect(result.returnValue).toEqual(expected);
    }
  );

  it("snapshots fromEntries pairs and keys without detaching the last duplicate value", async () => {
    const code = `
      const first = { count: 1 };
      const last = { count: 2 };
      const pair = ["chosen", last];
      const pairs = [["chosen", first], pair, ["other", last]];
      const preCallAlias = pairs[1] === pair && pair[1] === last;
      const result = Object.fromEntries(pairs);
      pair[0] = "renamed";
      pair[1] = first;
      pairs.push(["added", first]);
      last.count = 7;
      const chosenCount = result.chosen.count;
      const preserved = result.chosen === last && result.other === last;
      result.other = first;
      return {
        preCallAlias,
        preserved,
        chosenCount,
        firstCount: first.count,
        lastCount: last.count,
        keys: Object.keys(result),
        pairUnchanged: pairs[2][1] === last,
        freshOuter: result !== Object.fromEntries(pairs)
      };
    `;
    const expected = {
      preCallAlias: true,
      preserved: true,
      chosenCount: 7,
      firstCount: 1,
      lastCount: 7,
      keys: ["chosen", "other"],
      pairUnchanged: true,
      freshOuter: true
    };
    expect(new Function(code)()).toEqual(expected);
    const result = await run(code);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Manual pair workflow did not complete");
    expect(result.returnValue).toEqual(expected);
  });

  it.each(["structuredClone(source)", "JSON.parse(JSON.stringify(source))"])(
    "retains the explicit deep-copy boundary for %s",
    async (expression) => {
      const code = `
      const source = Object.fromEntries([["nested", { count: 1 }]]);
      const copy = ${expression};
      copy.nested.count = 7;
      return [source !== copy, source.nested !== copy.nested, source.nested.count, copy.nested.count];
    `;
      expect(new Function(code)()).toEqual([true, true, 1, 7]);
      const result = await run(code);
      expect(result).toMatchObject({ ok: true, returnValue: [true, true, 1, 7] });
    }
  );

  it("keeps caller bindings copied while preserving references inside the guest", async () => {
    const source = { nested: { count: 1 } };
    const result = await run(
      `
      const values = Object.values(source);
      values[0].count = 7;
      return [values[0] === source.nested, source.nested.count];
    `,
      { bindings: { source } }
    );
    expect(source.nested.count).toBe(1);
    expect(result).toMatchObject({ ok: true, returnValue: [true, 7] });
  });

  it("keeps module arguments and results copied around source-local transforms", async () => {
    const hostSource = { nested: { count: 1 } };
    let hostArgument: { item: { count: number } } | undefined;
    const result = await run(
      `
      import { provide, consume } from "fixture";
      const local = provide();
      const rebuilt = Object.fromEntries([["item", local.nested]]);
      rebuilt.item.count = 7;
      const localCount = local.nested.count;
      const returned = consume(rebuilt);
      returned.item.count = 11;
      return [localCount, rebuilt.item.count, returned.item.count];
    `,
      {
        modules: {
          fixture: {
            provide: () => hostSource,
            consume: (value: { item: { count: number } }) => {
              hostArgument = value;
              value.item.count = 9;
              return value;
            }
          }
        }
      }
    );
    expect(hostSource.nested.count).toBe(1);
    expect(hostArgument?.item.count).toBe(9);
    expect(result).toMatchObject({ ok: true, returnValue: [7, 7, 11] });
  });

  it.each(["entries", "values", "fromEntries"])("continues budgeting %s results", (method) => {
    const globals = createObjectArrayGlobals({ budget: new Budget({ arrayLength: 1 }) });
    const transform = globals.Object[method];
    if (!isSandboxClosure(transform)) throw new Error("Missing Object transform");
    const input = method === "fromEntries" ? [["nested", [1, 2]]] : { first: 1, second: 2 };
    expect(() => transform.call([input])).toThrowError(
      new SandboxError({ budget: "arrayLength", current: 2, limit: 1 })
    );
  });

  it.each(originalCases)(
    "matches the immutable native anchor for $id",
    async ({ code, caseName, sourceSha256, expected }) => {
      expect(createHash("sha256").update(code).digest("hex")).toBe(sourceSha256);
      expect(new Function("caseName", code)(caseName)).toEqual(expected);
      const result = await run(code, {
        bindings: caseName === undefined ? {} : { caseName },
        budget: new Budget({
          maxSteps: 20000,
          maxCallDepth: 48,
          stringLength: 16384,
          arrayLength: 512,
          dataSize: 500000
        })
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Original workflow did not complete");
      expect(result.returnValue).toEqual(expected);
    }
  );
});
