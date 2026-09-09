import type { SymbolEvent, SymbolScope } from "./symbol-collection.js";
import { PythonSyntaxError } from "./source.js";

/** Check declaration ordering/conflicts before resolving lexical binding owners. */
export function validateDeclarations(scope: SymbolScope, filename = "<string>"): void {
  const previous = new Map<string, Set<SymbolEvent["kind"]>>();
  for (const event of scope.events) {
    const kinds = previous.get(event.name) ?? new Set<SymbolEvent["kind"]>();
    if (event.kind === "global" || event.kind === "nonlocal") {
      let message: string | undefined;
      if (event.kind === "nonlocal" && scope.kind === "module") message = "nonlocal declaration not allowed at module level";
      else if (kinds.has("global") && event.kind === "nonlocal" || kinds.has("nonlocal") && event.kind === "global") message = `name '${event.name}' is nonlocal and global`;
      else if (kinds.has("parameter")) message = `name '${event.name}' is parameter and ${event.kind}`;
      else if (kinds.has("annotation")) message = `annotated name '${event.name}' can't be ${event.kind}`;
      else if (kinds.has("write") || kinds.has("delete") || kinds.has("write-outer")) message = `name '${event.name}' is assigned to before ${event.kind} declaration`;
      else if (kinds.has("read")) message = `name '${event.name}' is used prior to ${event.kind} declaration`;
      if (message) throw new PythonSyntaxError(message, filename, event.start);
    } else if (event.kind === "annotation" && (kinds.has("global") || kinds.has("nonlocal"))) {
      throw new PythonSyntaxError(`annotated name '${event.name}' can't be global or nonlocal`, filename, event.start);
    }
    kinds.add(event.kind);
    previous.set(event.name, kinds);
  }
  for (const child of scope.children) validateDeclarations(child, filename);
}
