import { error, numericResult } from "../values.js";
import { collect, numberArg, str, textArg } from "./common.js";
import { conversionUnits } from "./conversion-units.js";
import type { FunctionImplementation, SpecialForm } from "./types.js";

type Units = readonly (readonly [string, number])[];
function unit(name: string, units: Units, prefixes: Units): readonly [number, number] | undefined {
  const direct = units.find(([key]) => name === key);
  if (direct) return [direct[1], 1];
  const prefix = prefixes.find(([key]) => name.startsWith(key));
  const found = units.find(([key]) => key === (prefix ? name.slice(prefix[0].length) : name));
  return found ? [found[1], prefix?.[1] ?? 1] : undefined;
}
const groups: readonly (readonly [Units, Units])[] = [
  [conversionUnits.weight_units, conversionUnits.prefixes], [conversionUnits.distance_units, conversionUnits.prefixes],
  [conversionUnits.time_units, []], [conversionUnits.pressure_units, conversionUnits.prefixes],
  [conversionUnits.force_units, conversionUnits.prefixes], [conversionUnits.energy_units, conversionUnits.prefixes],
  [conversionUnits.power_units, conversionUnits.prefixes], [conversionUnits.magnetism_units, conversionUnits.prefixes],
  [conversionUnits.liquid_units, conversionUnits.prefixes], [conversionUnits.information_units, conversionUnits.prefixes],
  [conversionUnits.information_units, conversionUnits.binary_prefixes], [conversionUnits.speed_units, conversionUnits.prefixes],
  [conversionUnits.area_units, conversionUnits.prefixes]
];
const toKelvin: Readonly<Record<string, (n: number) => number>> = {
  K: n => n, C: n => n + 273.15, F: n => (n - 32) * 5 / 9 + 273.15,
  Rank: n => n * 5 / 9, Reau: n => n * 5 / 4 + 273.15
};
const fromKelvin: Readonly<Record<string, (n: number) => number>> = {
  K: n => n, C: n => n - 273.15, F: n => (n - 273.15) * 9 / 5 + 32,
  Rank: n => n * 9 / 5, Reau: n => (n - 273.15) * 4 / 5
};
export const engineeringExtraFunctions: Readonly<Record<string, FunctionImplementation>> = {
  CONVERT: (args, host) => {
    const n = numberArg(args, 0, host), from = textArg(args, 1, host), to = textArg(args, 2, host);
    if (toKelvin[from] && fromKelvin[to]) {
      const kelvin = toKelvin[from](n);
      return kelvin < 0 ? error("#NUM!") : numericResult(from === to ? n : fromKelvin[to](kelvin));
    }
    for (const [units, prefixes] of groups) {
      host.tick(); const source = unit(from, units, prefixes);
      if (!source) continue;
      const destination = unit(to, units, prefixes);
      if (!destination || source[0] === 0 || destination[1] === 0) return error("#NUM!");
      return numericResult(((n * source[1]) / source[0]) * destination[0] / destination[1]);
    }
    return error("#N/A");
  },
  HEXREP: (args, host) => {
    const n = numberArg(args, 0, host);
    if (n === 0) return str("0x0p+0");
    const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, n);
    const bits = view.getBigUint64(0), exponent = Number(bits >> 52n & 2047n), fraction = (bits & ((1n << 52n) - 1n)).toString(16).padStart(13, "0");
    let digits = fraction; while (digits.endsWith("0")) digits = digits.slice(0, -1);
    const power = exponent === 0 ? -1022 : exponent - 1023;
    return str(`${n < 0 ? "-" : ""}0x${exponent === 0 ? "0" : "1"}${digits ? "." + digits : ""}p${power < 0 ? "" : "+"}${power}`);
  }
};
export const engineeringExtraSpecialForms: Readonly<Record<string, SpecialForm>> = {
  INVSUMINV: (nodes, host) => {
    let count = 0, total = 0, zero = false, negative = false;
    for (const node of nodes) for (const cell of collect(host.evaluate(node, true), host)) {
      if (cell.kind === "error") return cell;
      if (cell.kind !== "number") continue;
      count++; if (cell.value < 0) { negative = true; continue; }
      if (cell.value === 0) zero = true; else total += 1 / cell.value;
    }
    return !count || negative ? error("#VALUE!") : numericResult(zero ? 0 : 1 / total);
  }
};
