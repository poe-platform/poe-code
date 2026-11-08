import { describe, expect, it } from "vitest";
import { interpret, Scope } from "./interpreter.js";
import { parseModule } from "../parse/parser.js";
import { createSandboxClosure, createSandboxPromise, isSandboxClosure } from "./values.js";
import { run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { AS003 } from "../lint/rules/AS003.js";
import { AS006_007 } from "../lint/rules/AS006-007.js";
import { AS_EXPORT_IMPORT_META } from "../lint/rules/AS-export-import-meta.js";

function program(source: string) {
  const module = parseModule(source);
  return { type: "BlockStatement" as const, body: module.body, span: module.span };
}

describe("default function declarations", () => {
  it("counts the default export as a use of its named declaration", () => {
    expect(AS006_007("export default function Named(){}")).toEqual([]);
  });
  it("exposes hoisted named declarations to lint and checks the entry-point signature", () => {
    const source = "const name=Named.name;export default async function Named(frontmatter){return [name,frontmatter]}";
    expect(AS003(source)).toEqual([]);
    expect(AS_EXPORT_IMPORT_META(source, { defaultExport: { parameters: ["frontmatter"], required: true } })).toEqual([]);
    expect(AS_EXPORT_IMPORT_META("export default function Named(wrong){}", { defaultExport: { parameters: ["frontmatter"], required: true } }).map(diagnostic => diagnostic.code)).toContain("AS-EXPORT-DEFAULT-SIGNATURE");
  });

  it.each([
    ["live alias", "export default function Named(){return 7}await wait();Named=()=>8;", 8],
    ["anonymous entry point", "await wait();export default function(){return 7}", 7],
    ["named metadata", "await wait();export default function Named(){return Named.name}", "Named"]
  ])("preserves %s across checkpoints", async (_name, source, expected) => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const original = run(source, {
      bindings: { wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(pending) }) },
      entryPointArgs: []
    });
    let snapshot: ReturnType<typeof JSON.parse>;
    try { snapshot = JSON.parse(await dump(original)); }
    finally { release(); await original; }
    expect(await original).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, {
      bindings: { wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(Promise.resolve()) }) },
      entryPointArgs: [], snapshot: restore(snapshot, { source })
    })).toMatchObject({ ok: true, returnValue: expected });
  });
  it.each([
    [
      "outer binding",
      "export default function Named(){} export const observed=typeof Named;",
      "observed"
    ],
    [
      "hoisted call",
      "export const observed=Named();export default function Named(){return 7}",
      "observed"
    ],
    ["live binding", "export default function Named(){} Named=7;", "target"],
    ["write before declaration", "Named=7;export default function Named(){return 8}", "target"],
    ["mutable inner reference", "export default function Named(){Named=7}Named();", "target"],
    [
      "recursion",
      "export default function Named(n){return n?1+Named(n-1):0}export const observed=Named(3);",
      "observed"
    ],
    [
      "async binding",
      "export default async function Named(){return 7}export const observed=await Named();",
      "observed"
    ],
    [
      "async hoist",
      "export const observed=await Named();export default async function Named(){return 7}",
      "observed"
    ],
    [
      "generator binding",
      "export default function* Named(){yield 7}export const observed=Named().next().value;",
      "observed"
    ],
    [
      "generator hoist",
      "export const observed=Named().next().value;export default function* Named(){yield 7}",
      "observed"
    ],
    ["anonymous name", "export default function(){}", "target.name"],
    ["anonymous async name", "export default async function(){}", "target.name"],
    ["anonymous generator name", "export default function*(){}", "target.name"],
    ["source", "export default function Named /* comment */ () {}", "target.toString()"],
    [
      "arguments",
      "export default function Named(){return arguments[0]}export const observed=Named(7);",
      "observed"
    ],
    [
      "construction",
      "export default function Named(value){this.value=value}export const observed=new Named(7).value;",
      "observed"
    ],
    ["class control", "export default class Named{} Named=7;", "target"],
    [
      "parenthesized control",
      "export default (function Named(){});export const observed=typeof Named;",
      "observed"
    ],
    ["arrow control", "export default ()=>{}", "target.name"],
    ["expression export control", "function Named(){}export default Named;Named=7;", "target.name"],
    ["parenthesized call control", "export default (function Named(){return 7})()", "target"]
  ])("matches native %s", async (_name, source, expression) => {
    const native = await import(
      /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`
    );
    const expected = new Function("target", "observed", `return ${expression};`)(
      native.default,
      native.observed
    );
    const result = await interpret(program(source));
    if (!result.ok) throw result.error;
    const actual = await interpret(program(`return ${expression};`), {
      bindings: {
        target: result.snapshot.bindings.default,
        observed: result.snapshot.bindings.observed
      }
    });
    if (!actual.ok) throw actual.error;
    expect(actual.returnValue).toEqual(expected);
  });

  it.each(["function(){}", "function Named(){}", "async function(){}", "function*(){}"])(
    "initializes %s before module body execution",
    async (definition) => {
      const scope = new Scope();
      let observed: string | undefined;
      scope.declare(
        "inspect",
        "const",
        createSandboxClosure({
          call: () => {
            const binding = scope.lookup("default");
            if (binding.found && isSandboxClosure(binding.value)) observed = binding.value.name;
            return undefined;
          }
        })
      );
      const result = await interpret(program(`inspect();export default ${definition}`), {
        scope,
        useScopeDirectly: true
      });
      if (!result.ok) throw result.error;
      expect(observed).toBe(definition.includes("Named") ? "Named" : "default");
    }
  );

  it.each([
    "export default function Named(){}()",
    "export default function(){}()",
    "export default async function Named(){}()",
    "export default function* Named(){}()",
    "export default function Named(){}.name",
    "const Named=7;export default function Named(){}",
    "export default function Named(){}let Named;",
    "var Named;export default function Named(){}",
    "export default function Named(){}function Named(){}",
    "function(){}"
  ])("rejects native-invalid modules: %s", async (source) => {
    await expect(
      import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`)
    ).rejects.toThrow();
    await expect(
      (async () => {
        const result = await interpret(program(source));
        if (!result.ok) throw result.error;
      })()
    ).rejects.toThrow();
  });
});
