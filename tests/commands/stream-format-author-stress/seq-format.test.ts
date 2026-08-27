import test from "node:test";
import { compare, type NativeCase } from "../stream-format/helpers.js";

export const seqFormatCases: readonly NativeCase[] = [
  { args: ["-f", "%.2f", "2.675", "2.675"] },
  { args: ["-f", "%.17g", "0.1", "0.1", "0.3"] },
  { args: ["-f", "%.1f", "0.15", "0.1", "0.45"] },
  { args: ["-f", "%g", "-0", "0"] }, { args: ["-w", "-0", "2"] },
  { args: ["-f", "%.17g", "1", "0.1", "1.3"] },
  { args: ["-f", "%.3f", "0", "0.1", "0.3"] },
  { args: ["-f", "<%+.2f>", "-0.15", "0.1", "0.15"] },
  { args: ["-f", "%.5e", "1e-310", "1e-310", "4e-310"] },
];
for (const fixture of seqFormatCases) test(`seq native binary format ${JSON.stringify(fixture.args)}`, () => compare("seq", fixture));
