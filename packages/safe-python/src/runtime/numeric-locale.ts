import { CodePointString } from "./code-point-string.js";
import { DigitGrouping } from "./digit-grouping.js";
import type { ExecutionMeter } from "./execution-budget.js";

/** Trusted execution owner; acquisition must not execute guest code. */
export type NumericLocaleSource = NumericLocale | (() => NumericLocale);

export function resolveNumericLocale(source: NumericLocaleSource, meter: ExecutionMeter): NumericLocale {
  const result = typeof source === "function" ? source() : source;
  meter.checkpoint();
  return result;
}

/** Execution-owned numeric locale snapshot. Strings are already immutable;
 * grouping bytes are copied/normalized. Acquisition never happens implicitly. */
export class NumericLocale {
  readonly decimalPoint: CodePointString;
  readonly thousandsSeparator: CodePointString;
  readonly grouping: DigitGrouping;

  static portable(meter: ExecutionMeter): NumericLocale {
    meter.checkpoint(1, 4);
    return new NumericLocale({
      decimalPoint: new CodePointString(Uint32Array.of(46), meter),
      thousandsSeparator: new CodePointString(new Uint32Array(0), meter),
      grouping: []
    }, meter);
  }

  constructor(data: { decimalPoint: CodePointString; thousandsSeparator: CodePointString; grouping: readonly number[] }, meter: ExecutionMeter) {
    meter.checkpoint(1, 128);
    this.decimalPoint = data.decimalPoint;
    this.thousandsSeparator = data.thousandsSeparator;
    this.grouping = new DigitGrouping(data.grouping, meter);
    Object.freeze(this);
  }
}
