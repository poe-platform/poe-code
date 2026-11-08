import { expect, it } from "vitest";
import { createPortableNumberFormatter } from "./numberformat-portable.js";
import { NumberFormat } from "../intl-data/dist/numberformat-engine.js";

it.each(["Meter", "METER", "nanoSecond", "microSecond", "meter-PER-second", "meter-per-Second"])(
  "rejects mixed-case portable unit identifiers before reading later options: %s", unit => {
    const trace: string[] = [];
    createPortableNumberFormatter("en", {});
    expect(() => new NumberFormat("en", {
      style: "unit", unit,
      get unitDisplay() { trace.push("unitDisplay"); return "long"; }
    })).toThrow(RangeError);
    expect(trace).toEqual([]);
  }
);
