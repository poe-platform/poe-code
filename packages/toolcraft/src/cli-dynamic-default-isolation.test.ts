import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { S, type AnySchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = previousExitCode; });

type DefaultKind = "array" | "json" | "record" | "object";
type CollectionKind = "record" | "array" | "nested record" | "nested array";
type Placement = "plain" | "oneOf" | "union";

function createDefault(kind: DefaultKind) {
  const original = kind === "array" ? ["seed"] : { items: ["seed"] };
  const schema: AnySchema = kind === "array"
    ? S.Array(S.String(), { default: original as string[] })
    : kind === "json"
      ? { ...S.Json(), default: original }
      : kind === "record"
        ? { ...S.Record(S.Array(S.String())), default: original as { items: string[] } }
        : S.Object({ items: S.Array(S.String()) }, { default: original as { items: string[] } });
  return { original, schema };
}

function collectionFor(kind: CollectionKind, field: AnySchema) {
  const entry = S.Object({ label: S.String(), defaulted: field });
  if (kind === "record") return { schema: S.Record(entry), paths: ["alpha", "beta"] };
  if (kind === "array") return { schema: S.Array(entry), paths: ["0", "1"] };
  if (kind === "nested record") {
    return { schema: S.Record(S.Object({ children: S.Record(entry) })), paths: ["group.children.alpha", "group.children.beta"] };
  }
  return { schema: S.Array(S.Object({ children: S.Array(entry) })), paths: ["0.children.0", "0.children.1"] };
}

function nestedValue(value: unknown, path: string): any {
  let current = value as Record<string, unknown>;
  for (const segment of path.split(".")) current = current[segment] as Record<string, unknown>;
  return current;
}

describe.each<Placement>(["plain", "oneOf", "union"])("%s dynamic-entry defaults", (placement) => {
  describe.each<CollectionKind>(["record", "array", "nested record", "nested array"])("%s", (collectionKind) => {
    describe.each<DefaultKind>(["array", "json", "record", "object"])("%s value", (defaultKind) => {
      it.each([
        { optional: false, explicit: false },
        { optional: true, explicit: false },
        { optional: false, explicit: true },
        { optional: true, explicit: true }
      ])("isolates entries and invocations with %j", async ({ optional, explicit }) => {
        const { original, schema: defaultSchema } = createDefault(defaultKind);
        const initialDefault = structuredClone(original);
        const collection = collectionFor(collectionKind, optional ? S.Optional(defaultSchema) : defaultSchema);
        const body = S.Object({ entries: collection.schema });
        const other = S.Object({ other: S.String() });
        const paramsSchema = placement === "plain" ? body : S.Object({
          payload: placement === "oneOf"
            ? S.OneOf({ discriminator: "kind", branches: { chosen: body, other } })
            : S.Union([body, other])
        });
        const prefix = placement === "plain" ? "entries" : "payload.entries";
        const selectors = placement === "plain" ? [] : placement === "oneOf"
          ? ["--payload.kind", "chosen"] : ["--payload-kind", "entries"];
        const args = [...selectors, ...collection.paths.flatMap((entryPath, index) => [`--${prefix}.${entryPath}.label`, `entry-${index}`])];
        if (explicit) {
          const fieldPath = `${prefix}.${collection.paths[0]}.defaulted`;
          args.push(
            `--${fieldPath}${defaultKind === "record" || defaultKind === "object" ? ".items" : ""}`,
            defaultKind === "json" ? JSON.stringify({ items: ["explicit"] }) : "explicit"
          );
        }
        const snapshots: string[][][] = [];
        const sharedReferences: boolean[] = [];
        const root = defineGroup({ name: "audit", children: [defineCommand({
          name: "check", params: paramsSchema,
          handler: ({ params }) => {
            const values = collection.paths.map((entryPath) => {
              const value = nestedValue(params, `${prefix}.${entryPath}.defaulted`);
              return (defaultKind === "array" ? value : value.items) as string[];
            });
            snapshots.push(structuredClone(values));
            sharedReferences.push(values[0] === values[1]);
            values[0]!.push("mutated");
            return {};
          }
        })] });
        const emitted: string[] = [];
        for (const iteration of [0, 1]) {
          await runCLI(root, {
            argv: ["node", "audit", "check", "--yes", ...args],
            controls: { yes: true }, approvals: false, errorReports: false,
            outputEmitter: (entry) => emitted.push(entry)
          });
          expect(process.exitCode, emitted.join("\n")).toBe(0);
          expect(snapshots).toHaveLength(iteration + 1);
        }
        expect(snapshots).toEqual([
          [[explicit ? "explicit" : "seed"], ["seed"]],
          [[explicit ? "explicit" : "seed"], ["seed"]]
        ]);
        expect(sharedReferences).toEqual([false, false]);
        expect(original).toEqual(initialDefault);
      });
    });
  });
});

describe.each<CollectionKind>(["record", "array", "nested record", "nested array"])("%s falsy defaults", (collectionKind) => {
  it.each([
    { name: "zero", schema: S.Number({ default: 0 }), expected: 0 },
    { name: "false", schema: S.Boolean({ default: false }), expected: false },
    { name: "empty string", schema: S.String({ default: "" }), expected: "" },
    { name: "nullable array", schema: S.Array(S.String(), { nullable: true, default: null }), expected: null }
  ])("preserves $name", async ({ schema, expected }) => {
    const collection = collectionFor(collectionKind, schema);
    const calls: unknown[][] = [];
    const root = defineGroup({ name: "audit", children: [defineCommand({
      name: "check", params: S.Object({ entries: collection.schema }),
      handler: ({ params }) => {
        calls.push(collection.paths.map((entryPath) => nestedValue(params, `entries.${entryPath}.defaulted`)));
        return {};
      }
    })] });
    await runCLI(root, {
      argv: ["node", "audit", "check", "--yes", ...collection.paths.flatMap((entryPath) => [`--entries.${entryPath}.label`, "ready"])],
      controls: { yes: true }, approvals: false, errorReports: false, outputEmitter: () => {}
    });
    expect(process.exitCode).toBe(0);
    expect(calls).toEqual([[expected, expected]]);
  });
});
