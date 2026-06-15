import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { S, toJsonSchema } from "toolcraft-schema";

import { makeSearchCommand } from "./search.js";
import { resolveCommandTree } from "./tree.js";

function fixtureCommand(
  name: string,
  description: string,
  params = S.Object({
    id: S.String({ description: "Identifier" })
  })
) {
  return defineCommand({
    name,
    description,
    scope: ["sdk"],
    params,
    handler: async () => null
  });
}

async function fixtureEntries() {
  const root = defineGroup({
    name: "root",
    children: [
      defineGroup({
        name: "alpha",
        children: [fixtureCommand("alpha", "Open exact channel")]
      }),
      defineGroup({
        name: "support",
        children: [fixtureCommand("notes", "Alpha support route")]
      }),
      defineGroup({
        name: "billing",
        children: [
          fixtureCommand("reconcile", "Compare ledger totals"),
          fixtureCommand("refund", "Issue customer task refund"),
          fixtureCommand("capture", "Capture authorized task payment")
        ]
      }),
      defineGroup({
        name: "tasks",
        children: [
          fixtureCommand("create", "Create task"),
          fixtureCommand("assign", "Assign task"),
          fixtureCommand("close", "Close task"),
          fixtureCommand("list", "List task"),
          fixtureCommand("archive", "Archive task")
        ]
      }),
      defineGroup({
        name: "profiles",
        children: [fixtureCommand("inspect", "Inspect user profile")]
      })
    ]
  });

  return (await resolveCommandTree(root)).entries;
}

async function sharedEntries(count: number) {
  const root = defineGroup({
    name: "root",
    children: [
      defineGroup({
        name: "shared",
        children: Array.from({ length: count }, (_value, index) =>
          fixtureCommand(`item_${index}`, "Shared lookup")
        )
      })
    ]
  });

  return (await resolveCommandTree(root)).entries;
}

async function runSearch(
  params: {
    query: string;
    limit?: number;
    detail?: "brief" | "detailed" | "full";
  },
  defaults: { detail?: "brief" | "detailed" | "full"; limit?: number } = {}
) {
  const command = makeSearchCommand({
    entries: await fixtureEntries(),
    defaults
  });

  return command.handler({ params } as never);
}

describe("makeSearchCommand", () => {
  it("ranks an exact command name match before a description match", async () => {
    const results = await runSearch({ query: "alpha" });

    expect(results.map((result) => result.path).slice(0, 2)).toEqual([
      "alpha.alpha",
      "support.notes"
    ]);
  });

  it("scores path tokens", async () => {
    const results = await runSearch({ query: "billing" });

    expect(results.map((result) => result.path)).toContain("billing.reconcile");
  });

  it("uses explicit limits before default limits and truncates results", async () => {
    const explicitLimitResults = await runSearch({ query: "task", limit: 2 }, { limit: 4 });
    const defaultLimitResults = await runSearch({ query: "task" }, { limit: 3 });

    expect(explicitLimitResults).toHaveLength(2);
    expect(defaultLimitResults).toHaveLength(3);
  });

  it("falls back to ten results when no limit is provided", async () => {
    const command = makeSearchCommand({
      entries: await sharedEntries(11)
    });
    const results = await command.handler({ params: { query: "shared" } } as never);

    expect(results).toHaveLength(10);
  });

  it("tokenizes queries case-insensitively across punctuation", async () => {
    const results = await runSearch({ query: "BILLING/refund!" });

    expect(results[0]?.path).toBe("billing.refund");
  });

  it("returns no results for empty-token queries and zero limits", async () => {
    await expect(runSearch({ query: "---...---" })).resolves.toEqual([]);
    await expect(runSearch({ query: "task", limit: 0 })).resolves.toEqual([]);
    await expect(runSearch({ query: "task", limit: 0 })).resolves.toEqual([]);
  });

  it("rejects negative search limits", async () => {
    await expect(runSearch({ query: "task", limit: -1 })).rejects.toThrow(
      "limit must be a non-negative integer, received -1"
    );
  });

  it("advertises search limits as non-negative integers", () => {
    const command = makeSearchCommand({
      entries: []
    });

    expect(toJsonSchema(command.params)).toMatchObject({
      properties: {
        limit: {
          type: "integer",
          minimum: 0
        }
      }
    });
  });

  it("rejects invalid default detail values", async () => {
    const command = makeSearchCommand({
      entries: await fixtureEntries(),
      defaults: {
        detail: "invalid" as "brief"
      }
    });

    await expect(command.handler({ params: { query: "profile" } } as never)).rejects.toThrow(
      'detail must be one of: brief, detailed, full, received "invalid"'
    );
  });

  it("emits schemas only for detailed and full results", async () => {
    const briefResults = await runSearch({ query: "inspect", detail: "brief" });
    const detailedResults = await runSearch({ query: "inspect", detail: "detailed" });
    const fullResults = await runSearch({ query: "inspect", detail: "full" });
    const expectedSchema = toJsonSchema(
      S.Object({
        id: S.String({ description: "Identifier" })
      })
    );

    expect(briefResults[0]).toEqual({
      path: "profiles.inspect",
      description: "Inspect user profile"
    });
    expect(detailedResults[0]).toEqual({
      path: "profiles.inspect",
      description: "Inspect user profile",
      schema: expectedSchema
    });
    expect(fullResults[0]).toEqual({
      path: "profiles.inspect",
      description: "Inspect user profile",
      schema: expectedSchema
    });
  });

  it("does not reach for the RegExp constructor", () => {
    const source = readFileSync(new URL("./search.ts", import.meta.url), "utf8");

    expect(source).not.toContain("RegExp");
  });
});
