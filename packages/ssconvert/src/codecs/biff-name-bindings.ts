import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { BiffFormulaContext } from "./biff-formulas.js";
import { parseExpression } from "../formulas/parser.js";

type Resolver = NonNullable<BiffFormulaContext["resolveName"]>;
interface Binding { name: string; index?: number; dependencies: readonly Reference[]; }
type Reference = Binding | "#REF!" | "#NAME?";
interface CapturedReference { target: Reference; functionName: string | undefined; }

/** NAME records bind sequentially; references retain objects even after an index is replaced. */
export class BiffNameBindings {
  private readonly slots = new Map<number, Binding>();
  private readonly definitions = new Map<number, { translate: (resolve: Resolver) => string;
    references: readonly CapturedReference[]; placeholder: boolean }>();
  private work = 0;

  constructor(private readonly context: CapabilityContext) {}

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

  define(index: number, name: string, translate: (resolve: Resolver) => string): boolean {
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
        return false;
      }
      seen.add(dependency);
      for (const next of dependency.dependencies) { this.tick(); pending.push(next); }
    }
    const binding = stub ?? { name, dependencies: [] };
    binding.name = name;
    binding.index = index;
    binding.dependencies = dependencies;
    this.slots.set(index, binding);
    const parsed = parseExpression(expression, { position: { sheet: "", row: 0, column: 0 },
      signal: this.context.signal, maximumLength: this.context.limits.inputBytes,
      ...(this.context.limits.workbookNodes === undefined ? {} : { maximumNodes: this.context.limits.workbookNodes }) });
    let root = parsed.ok ? parsed.document.root : undefined;
    while (root?.kind === "parentheses") { this.tick(); root = root.child; }
    const placeholder = root?.kind === "literal" && root.value.kind === "error" && root.value.value === "#NAME?";
    this.definitions.set(index, { translate, references, placeholder });
    return true;
  }

  finish(): readonly number[] {
    // Native importer teardown unlinks top-level #NAME? definitions. Existing
    // references keep their now-inactive objects and evaluate to #REF!.
    for (const [index, definition] of Array.from(this.definitions).reverse()) {
      this.tick();
      if (definition.placeholder) {
        delete this.slots.get(index)!.index;
        this.definitions.delete(index);
      }
    }
    return Array.from(this.definitions.keys());
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
