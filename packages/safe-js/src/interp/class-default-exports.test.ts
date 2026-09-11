import { describe, expect, it } from "vitest";
import { interpret } from "./interpreter.js";
import { parseModule } from "../parse/parser.js";
import { AS003 } from "../lint/rules/AS003.js";
import { AS_UNBOUNDED_LOOP } from "../lint/rules/AS-unbounded-loop.js";
import { findExportedConstInitializer } from "../loader/find-exported.js";
import { run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { createSandboxClosure, createSandboxPromise } from "./values.js";

function program(source: string) {
  const module = parseModule(source);
  return { type: "BlockStatement" as const, body: module.body, span: module.span };
}

describe("default class exports", () => {
  it("keeps a reassigned default binding live after a checkpoint", async () => {
    const source = "export default class Named{};Named=()=>7;await wait();Named=()=>8;";
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = run(source, {
      bindings: {
        wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(pending) })
      },
      entryPointArgs: []
    });
    let snapshot: ReturnType<typeof JSON.parse>;
    try {
      snapshot = JSON.parse(await dump(original));
    } finally {
      release();
      await original;
    }
    expect(await original).toMatchObject({ ok: true, returnValue: 8 });
    expect(
      await run(source, {
        bindings: {
          wait: createSandboxClosure({
            async: true,
            call: () => createSandboxPromise(Promise.resolve())
          })
        },
        entryPointArgs: [],
        snapshot: restore(snapshot, { source })
      })
    ).toMatchObject({ ok: true, returnValue: 8 });
  });

  it("exposes the named declaration to module references and export extraction", () => {
    const source = "export default class Named {} export const observed=Named.name;";
    expect(AS003(source)).toEqual([]);
    expect(findExportedConstInitializer(parseModule(source), "default")).toMatchObject({
      type: "ClassDeclaration",
      id: { name: "Named" }
    });
  });
  it("visits exported class references and loops", () => {
    expect(AS003("export default class Named {read(){return missing}}")).toHaveLength(1);
    expect(AS_UNBOUNDED_LOOP("export default class Named {read(){while(true){}}}")).toHaveLength(1);
  });
  it.each([
    ["anonymous name", "export default class {}", "target.name"],
    ["named declaration", "export default class Named {}", "target.name"],
    ["instance fields", "export default class {value=7}", "new target().value"],
    ["static inferred name", "export default class {static value=this.name}", "target.value"],
    ["static block", "export default class {static {this.value=this.name}}", "target.value"],
    ["extends", "class Base {value=7} export default class extends Base {}", "new target().value"],
    [
      "outer binding",
      "export default class Named {} export const observed=Named.name;",
      "observed"
    ],
    ["live default binding", "export default class Named {} Named=7;", "target"],
    [
      "inner name",
      "export default class Named {read(){return Named.name}} export const observed=new Named().read();",
      "observed"
    ],
    [
      "inner immutable",
      "export default class Named {static change(){try{Named=7}catch(e){return e.name}}} export const observed=Named.change();",
      "observed"
    ],
    [
      "temporal dead zone",
      "let found;try{Named}catch(e){found=e.name}export default class Named {} export const observed=found;",
      "observed"
    ],
    ["parenthesized anonymous", "export default (class {})", "target.name"],
    [
      "parenthesized named",
      "export default (class Named {}); export const observed=typeof Named;",
      "[target.name,observed]"
    ],
    ["ordinary expression control", "const Named=class {};export default Named;", "target.name"]
  ])("matches native %s", async (_name, source, expression) => {
    const native = await import(
      /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`
    );
    const expected = new Function("target", "observed", `return ${expression};`)(
      native.default,
      native.observed
    );
    const evaluated = await interpret(program(source));
    if (!evaluated.ok) throw evaluated.error;
    const actual = await interpret(program(`return ${expression};`), {
      bindings: {
        target: evaluated.snapshot.bindings.default,
        observed: evaluated.snapshot.bindings.observed
      }
    });
    if (!actual.ok) throw actual.error;
    expect(actual.returnValue).toEqual(expected);
  });

  it.each([
    "const Named=7;export default class Named {}",
    "export default class Named {} let Named;",
    "export default class Named extends Named {}",
    "export default class {}.name;"
  ])("rejects native-invalid or uninitializable modules: %s", async (source) => {
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
