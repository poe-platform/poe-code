import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { BiffFormulaContext } from "./biff-formulas.js";
import { parseExpression } from "../formulas/parser.js";
import { gnumericGrammar } from "../formulas/conventions.js";
import { quoteFormulaString } from "../formulas/serialization.js";
import type { NamedExpression } from "../workbook.js";

type Resolver = NonNullable<BiffFormulaContext["resolveName"]>;
interface Binding { name: string; index?: number; dependencies: readonly Reference[]; placeholder?: boolean;
  permanent?: boolean; defaultExpression?: string; }
type Reference = Binding | "#REF!" | "#NAME?";
interface CapturedReference { target: Reference; functionName: string | undefined; }

/** NAME records bind sequentially; references retain objects even after an index is replaced. */
export class BiffNameBindings {
  private readonly slots = new Map<number, Binding>();
  private readonly scopes = new Map<string | undefined, Map<string, Binding>>();
  private readonly definitions = new Map<number, { translate: (resolve: Resolver) => string;
    references: readonly CapturedReference[]; placeholder: boolean }>();
  private work = 0;

  constructor(private readonly context: CapabilityContext, sheets: readonly { name: string }[]) {
    for (const sheet of sheets) {
      this.tick();
      this.scopes.set(sheet.name, new Map([
        ["Sheet_Title", { name: "Sheet_Title", dependencies: [], permanent: true,
          defaultExpression: "=" + quoteFormulaString(sheet.name, '"', gnumericGrammar) }],
        ["Print_Area", { name: "Print_Area", dependencies: [], permanent: true, defaultExpression: "=#REF!" }]
      ]));
    }
  }

  private tick(): void {
    this.context.signal.throwIfAborted();
    if (++this.work > (this.context.limits.workbookWork ?? this.context.limits.inputBytes * 8))
      throw new SsconvertError("resource-limit", "ssconvert BIFF name binding work limit exceeded");
  }

  private reference(index: number, qualified: boolean): Reference {
    this.tick();
    const existing = this.slots.get(index);
    if (existing) return existing;
    if (qualified) return "#REF!";
    if (index < 1 || index >= 256) return "#NAME?";
    const stub: Binding = { name: `FwdDecl${index}`, dependencies: [] };
    this.slots.set(index, stub);
    return stub;
  }

  readonly resolve: Resolver = (index, qualified) => {
    const reference = this.reference(index, qualified);
    return typeof reference === "string" ? { value: reference, functionName: undefined } :
      { value: reference.index ?? "#REF!", functionName: reference.name };
  };

  define(index: number, name: string, sheet: string | undefined, translate: (resolve: Resolver) => string): void {
    this.tick();
    // Native captures the old stub before parsing. A self reference created
    // during parsing therefore remains unlinked when this slot is replaced.
    const stub = this.slots.get(index), references: CapturedReference[] = [];
    const expression = translate((target, qualified) => {
      const reference = this.reference(target, qualified);
      // A custom function is selected immediately, before a forward stub may
      // acquire its eventual declared name. Preserve that original spelling.
      const functionName = typeof reference === "string" ? undefined : reference.name;
      references.push({ target: reference, functionName });
      return { value: typeof reference === "string" ? reference : target, functionName };
    });
    const dependencies = references.map(reference => reference.target);
    const pending = [...dependencies], seen = new Set<Binding>();
    while (pending.length) {
      this.tick();
      const dependency = pending.pop()!;
      if (typeof dependency === "string" || seen.has(dependency)) continue;
      if (dependency.name === name || stub !== undefined && dependency.name === stub.name) {
        this.slots.delete(index);
        return;
      }
      seen.add(dependency);
      for (const next of dependency.dependencies) { this.tick(); pending.push(next); }
    }
    const scope = this.scopes.get(sheet) ?? new Map<string, Binding>();
    const existing = scope.get(name);
    if (existing && !existing.placeholder && !existing.permanent) {
      this.slots.delete(index);
      return;
    }
    const parsed = parseExpression(expression, { position: { sheet: "", row: 0, column: 0 },
      signal: this.context.signal, maximumLength: this.context.limits.inputBytes,
      ...(this.context.limits.workbookNodes === undefined ? {} : { maximumNodes: this.context.limits.workbookNodes }) });
    let root = parsed.ok ? parsed.document.root : undefined;
    while (root?.kind === "parentheses") { this.tick(); root = root.child; }
    const placeholder = root?.kind === "literal" && root.value.kind === "error" && root.value.value === "#NAME?";
    // A later definition replaces the lexical placeholder in place. Both
    // indexed slots and references parsed earlier retain that same object.
    const binding = existing ?? stub ?? { name, dependencies: [] };
    if (binding.index !== undefined) this.definitions.delete(binding.index);
    binding.name = name;
    binding.index = index;
    binding.dependencies = dependencies;
    binding.placeholder = placeholder;
    delete binding.defaultExpression;
    this.slots.set(index, binding);
    scope.set(name, binding);
    this.scopes.set(sheet, scope);
    this.definitions.set(index, { translate, references, placeholder });
  }

  finish(): { indices: readonly number[]; defaults: readonly NamedExpression[] } {
    // Native importer teardown unlinks top-level #NAME? definitions. Existing
    // references keep their now-inactive objects and evaluate to #REF!.
    for (const [index, definition] of Array.from(this.definitions).reverse()) {
      this.tick();
      if (definition.placeholder) {
        delete this.slots.get(index)!.index;
        this.definitions.delete(index);
      }
    }
    const defaults: NamedExpression[] = [];
    for (const [sheet, scope] of this.scopes) for (const binding of scope.values()) {
      this.tick();
      if (binding.defaultExpression !== undefined) defaults.push({ name: binding.name, expression: binding.defaultExpression,
        ...(sheet === undefined ? {} : { sheet }) });
    }
    return { indices: Array.from(this.definitions.keys()), defaults };
  }

  expression(index: number): string {
    this.tick();
    const definition = this.definitions.get(index)!;
    let at = 0;
    return definition.translate(() => {
      this.tick();
      const { target, functionName } = definition.references[at++]!;
      return { value: typeof target === "string" ? target : target.index ?? "#REF!", functionName };
    });
  }
}
