import type { CodePointString } from "./code-point-string.js";
import { DigitGrouping } from "./digit-grouping.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Execution-owned numeric locale snapshot. Strings are already immutable;
 * grouping bytes are copied/normalized. Acquisition never happens implicitly. */
export class NumericLocale {
  readonly decimalPoint: CodePointString;
  readonly thousandsSeparator: CodePointString;
  readonly grouping: DigitGrouping;

  constructor(data: { decimalPoint: CodePointString; thousandsSeparator: CodePointString; grouping: readonly number[] }, meter: ExecutionMeter) {
    meter.checkpoint(1, 128);
    this.decimalPoint = data.decimalPoint;
    this.thousandsSeparator = data.thousandsSeparator;
    this.grouping = new DigitGrouping(data.grouping, meter);
    Object.freeze(this);
  }
}
