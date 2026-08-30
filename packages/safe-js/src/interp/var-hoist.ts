import type { ParseResult } from "../parse.js";
import { boundIdentifiers, hoistedVarDeclarations } from "../parse/bindings.js";
import type { Scope } from "./scope.js";

export function hoistVarDeclarations(node: ParseResult, scope: Scope): void {
  for (const declaration of hoistedVarDeclarations([node])) {
    for (const declarator of declaration.declarations) {
      for (const identifier of boundIdentifiers(declarator.id)) {
        scope.declareVar(identifier.name);
      }
    }
  }
}
