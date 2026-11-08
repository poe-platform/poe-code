import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S, type AnySchema } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { runCLI } from "./cli.js";

const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = previousExitCode; });

const members = [
  { key: "target", flag: "target" },
  { key: "constructor", flag: "constructor" },
  { key: "toString", flag: "to-string" },
  { key: "hasOwnProperty", flag: "has-own-property" },
  { key: "__proto__", flag: "proto" }
];
const fields: Array<{ kind: string; schema: AnySchema; suffix: string; args: string[]; value: unknown }> = [
  { kind: "string", schema: S.String(), suffix: "", args: ["value"], value: "value" },
  { kind: "number", schema: S.Number(), suffix: "", args: ["42"], value: 42 },
  { kind: "array", schema: S.Array(S.String()), suffix: "", args: ["first", "second"], value: ["first", "second"] },
  { kind: "record", schema: S.Record(S.String()), suffix: ".entry", args: ["value"], value: { entry: "value" } }
];

describe.each(["discriminator", "union"] as const)("CLI %s branch own properties", (variantKind) => {
  describe.each([false, true])("nested object: %s", (nested) => {
    describe.each(members)("$key", ({ key, flag }) => {
      describe.each(fields)("$kind", ({ schema, suffix, args, value }) => {
        it.each([false, true])("provided: %s", async (provided) => {
          const branch = S.Object({ present: S.String(), [key]: schema });
          const variant = variantKind === "discriminator"
            ? S.OneOf({ discriminator: "mode", branches: { safe: branch } })
            : S.Union([branch]);
          const params = S.Object(nested ? { outer: S.Object({ payload: variant }) } : { payload: variant });
          const handler = vi.fn(({ params }: { params: Record<string, any> }) => params);
          const root = defineGroup({ name: "audit", children: [defineCommand({ name: "check", params, handler })] });
          const prefix = nested ? "outer.payload" : "payload";
          const selector = variantKind === "discriminator"
            ? [`--${prefix}.mode`, "safe"]
            : [`--${prefix}-kind`, ["present", flag].sort().join("+")];
          const output: string[] = [];
          await runCLI(root, {
            argv: ["node", "audit", "check", ...selector, `--${prefix}.present`, "anchor", ...(provided ? [`--${prefix}.${flag}${suffix}`, ...args] : []), "--yes"],
            controls: { yes: true },
            errorReports: false,
            outputEmitter: (message) => output.push(message)
          });
          if (!provided) {
            expect(process.exitCode).toBe(1);
            expect(handler).not.toHaveBeenCalled();
            expect(output.join("\n")).toContain(`Missing required parameter "${prefix}.${key}"`);
            return;
          }
          expect(process.exitCode).toBe(0);
          expect(handler).toHaveBeenCalledOnce();
          const received = handler.mock.calls[0]![0].params;
          const payload = nested ? received.outer.payload : received.payload;
          expect(Object.prototype.hasOwnProperty.call(payload, key)).toBe(true);
          expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
          expect(payload).toEqual({ present: "anchor", ...(variantKind === "discriminator" ? { mode: "safe" } : {}), [key]: value });
        });
      });
    });
  });
});
