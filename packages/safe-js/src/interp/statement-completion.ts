import type { Budget } from "./budget.js";
import type { CompletionResult, EvaluationResult } from "./exceptions.js";
import { retainValues } from "./resources.js";
import type { SandboxValue } from "./values.js";

/** Retain the last non-empty statement value while evaluating an eval script. */
export class StatementCompletion {
  private value: SandboxValue;
  readonly close: () => void;

  constructor(budget: Budget, private hasValue = false) {
    this.close = retainValues(budget, () => [this.value]);
  }

  update<TError>(result: EvaluationResult<TError>): EvaluationResult<TError> {
    if (result.kind === "error") return result;
    if (result.hasValue) {
      this.hasValue = true;
      this.value = result.value;
    } else if (this.hasValue && (result.kind === "break" || result.kind === "continue")) {
      return {...result, hasValue: true, value: this.value};
    }
    return result;
  }

  normal(): CompletionResult {
    return {kind: "normal", hasValue: this.hasValue, value: this.value};
  }
}
