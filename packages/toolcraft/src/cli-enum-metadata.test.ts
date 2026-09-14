import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, type ObjectSchema } from "toolcraft-schema";
import { defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createCLICommandTreeSnapshot, runCLI, type CLICommandTreeSnapshotOption } from "./cli.js";

const previousExitCode = process.exitCode;
const loadOptions = vi.fn(() => { throw new Error("Help must not load interactive options"); });
beforeEach(() => {
  process.exitCode = 0;
  loadOptions.mockClear();
});
afterEach(() => {
  process.exitCode = previousExitCode;
  vi.restoreAllMocks();
});

const fixtures: Array<{
  name: string;
  schema: ObjectSchema<any>;
  field: string;
  choices: string[];
  positional?: string[];
}> = [
  { name: "strings", schema: S.Object({ mode: S.Enum(["fast", "safe"]) }), field: "mode", choices: ["fast", "safe"] },
  { name: "numbers", schema: S.Object({ mode: S.Enum([0, 2, -3]) }), field: "mode", choices: ["0", "2", "-3"] },
  { name: "booleans", schema: S.Object({ mode: S.Enum([false, true]) }), field: "mode", choices: ["false", "true"] },
  { name: "mixed types", schema: S.Object({ mode: S.Enum(["go", 2, false]) }), field: "mode", choices: ["go", "2", "false"] },
  { name: "nullable", schema: S.Object({ mode: S.Enum(["fast", "safe"], { nullable: true }) }), field: "mode", choices: ["fast", "safe", "null"] },
  { name: "nullable literal null", schema: S.Object({ mode: S.Enum(["null", "safe"], { nullable: true }) }), field: "mode", choices: ["null", "safe"] },
  { name: "optional", schema: S.Object({ mode: S.Optional(S.Enum(["fast", "safe"])) }), field: "mode", choices: ["fast", "safe"] },
  { name: "defaulted", schema: S.Object({ mode: S.Enum(["fast", "safe"], { default: "safe" }) }), field: "mode", choices: ["fast", "safe"] },
  { name: "positional", schema: S.Object({ mode: S.Enum(["fast", "safe"]) }), field: "mode", choices: ["fast", "safe"], positional: ["mode"] },
  { name: "nested", schema: S.Object({ config: S.Object({ mode: S.Enum(["fast", "safe"]) }) }), field: "config.mode", choices: ["fast", "safe"] },
  { name: "labels", schema: S.Object({ mode: S.Enum(["fast", "safe"], { labels: { fast: "Quick mode", safe: "Careful mode" } }) }), field: "mode", choices: ["fast", "safe"] },
  { name: "deferred choices", schema: S.Object({ mode: S.Enum(["fast", "safe"], { loadOptions }) }), field: "mode", choices: ["fast", "safe"] },
  { name: "spaces and punctuation", schema: S.Object({ mode: S.Enum(["two words", "with+plus", "under_score"]) }), field: "mode", choices: ["two words", "with+plus", "under_score"] },
  { name: "large enum", schema: S.Object({ mode: S.Enum(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]) }), field: "mode", choices: ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] },
  { name: "oneOf selector", schema: S.Object({ payload: S.OneOf({ discriminator: "kind", branches: { first: S.Object({ left: S.String() }), second: S.Object({ right: S.String() }) } }) }), field: "payload.kind", choices: ["first", "second"] },
  { name: "colliding union selector", schema: S.Object({ payload: S.Union([S.Object({ "first+second": S.String() }), S.Object({ first: S.String(), second: S.String() })]) }), field: "payload-kind", choices: ["first+second", "first+second (branch 2)"] }
];

function createRoot(schema: ObjectSchema<any>, streaming: boolean, positional?: string[]) {
  const handler = vi.fn(() => null);
  const config = { name: "read", scope: ["cli"] as const, params: schema, positional };
  const command = streaming
    ? defineStreamCommand({ ...config, event: S.Json(), async *handler() { yield handler(); } })
    : defineCommand({ ...config, handler });
  return { root: defineGroup({ name: "audit", children: [command] }), handler };
}

describe.each(["kebab", "snake"] as const)("%s enum metadata", (casing) => {
  describe.each([false, true])("streaming=%s", (streaming) => {
    describe.each(["snapshot", "json"] as const)("%s", (surface) => {
      async function readOptions(schema: ObjectSchema<any>, positional?: string[]) {
        const { root, handler } = createRoot(schema, streaming, positional);
        let options: CLICommandTreeSnapshotOption[];
        if (surface === "snapshot") {
          const snapshot = await createCLICommandTreeSnapshot(root, { casing });
          const command = snapshot.root.children[0];
          if (command?.kind !== "command") throw new Error("Expected command metadata");
          options = command.options;
        } else {
          const stdout: string[] = [];
          const writer = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
            stdout.push(String(chunk));
            return true;
          });
          try {
            await runCLI(root, {
              argv: ["node", "audit", "read", "--help", "--output", "json"],
              casing,
              controls: { output: true },
              errorReports: false
            });
          } finally {
            writer.mockRestore();
          }
          expect(process.exitCode ?? 0).toBe(0);
          options = JSON.parse(stdout.join("")).options;
        }
        expect(handler).not.toHaveBeenCalled();
        expect(loadOptions).not.toHaveBeenCalled();
        return options;
      }

      it.each(fixtures)("exposes accepted tokens for $name", async (fixture) => {
        const options = await readOptions(fixture.schema, fixture.positional);
        expect(options.find((option) => option.name === fixture.field)).toMatchObject({
          type: "enum",
          choices: fixture.choices
        });
      });

      it("keeps non-enum options unchanged", async () => {
        const options = await readOptions(S.Object({
          text: S.String(),
          amount: S.Number(),
          enabled: S.Boolean(),
          modes: S.Array(S.Enum(["fast", "safe"]))
        }));
        expect(options.map((option) => option.type)).toEqual(["string", "number", "boolean", "array"]);
        for (const option of options) expect(option).not.toHaveProperty("choices");
      });

      it("keeps default and positional metadata", async () => {
        const options = await readOptions(S.Object({ mode: S.Enum(["fast", "safe"], { default: "safe", description: "Execution mode" }) }), ["mode"]);
        expect(options[0]).toMatchObject({
          name: "mode",
          flags: ["[mode]"],
          type: "enum",
          required: false,
          description: "Execution mode",
          default: "safe",
          positional: true
        });
      });

      it("does not share mutable choice arrays with schemas or later metadata", async () => {
        const values: [string, ...string[]] = ["fast", "safe"];
        const schema = S.Object({ mode: S.Enum(values) });
        const first = await readOptions(schema);
        expect(first[0]?.choices).toEqual(["fast", "safe"]);
        first[0]!.choices!.push("injected");
        expect(values).toEqual(["fast", "safe"]);
        const second = await readOptions(schema);
        expect(second[0]?.choices).toEqual(["fast", "safe"]);
      });
    });

    it("includes accepted values for built-in enum controls", async () => {
      const { root } = createRoot(S.Object({}), streaming);
      const snapshot = await createCLICommandTreeSnapshot(root, {
        casing,
        controls: { debug: true, logLevel: true, output: { formats: { compact: () => "" } } }
      });
      expect(snapshot.globalOptions.find((option) => option.name === "output")?.choices).toEqual(["rich", "md", "markdown", "json", "compact"]);
      expect(snapshot.globalOptions.find((option) => option.name === "debug")?.choices).toEqual(["trim", "raw"]);
      expect(snapshot.globalOptions.find((option) => option.name === "logLevel")?.choices).toEqual(["silent", "error", "warn", "info", "debug", "trace"]);
    });
  });
});
