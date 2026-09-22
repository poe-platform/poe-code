import { regressionFunctions } from "./statistical-regression.js";
import { statisticalTestFunctions, cronbach } from "./statistical-tests.js";
import { randomFunctions, simtable } from "./random.js";
import { timeSeriesFunctions } from "./time-series.js";
import { distributionFunctions } from "./distributions.js";
import { statisticsFunctions, statisticsSpecialForms, subtotalSpecialForm } from "./statistics.js";
import { erlangFunctions } from "./erlang.js";
import { financialFunctions, financialSpecialForms } from "./financial.js";
import { derivativeFunctions } from "./derivatives.js";
import { calendarFunctions } from "./calendars.js";
import { dateFunctions } from "./dates.js";
import { error, numericResult } from "../values.js";
import { SsconvertError } from "../../contracts.js";
import type { CellValue } from "../../workbook.js";
import { functionDescriptors } from "../function-descriptors.js";
import { asBoolean, admitMatrix } from "./common.js";
import { logicalFunctions, logicalSpecialForms } from "./logical.js";
import { matchNumber, textFunctions, textSpecialForms } from "./text.js";
import { infoFunctions, infoSpecialForms } from "./info.js";
import { lookupFunctions, lookupSpecialForms } from "./lookup.js";
import { databaseFunctions } from "./database.js";
import { floatingPointFunctions } from "./floating-point.js";
import { engineeringFunctions } from "./engineering.js";
import { mathFunctions, mathSpecialForms } from "./math.js";
import { matrixFunctions } from "./matrix.js";
import { scientificFunctions } from "./scientific.js";
import { complexFunctions, complexSpecialForms } from "./complex.js";
import { conditionalMathFunctions, conditionalMathSpecialForms } from "./conditional-math.js";
import { engineeringExtraFunctions, engineeringExtraSpecialForms } from "./engineering-extra.js";
import { romanFunctions } from "./roman.js";
import { specialNumericFunctions } from "./special-numeric.js";
import { complexScientificFunctions } from "./complex-scientific.js";
import { reducePiFunctions } from "./reduce-pi.js";
import { numberTheoryFunctions, numberTheorySpecialForms } from "./number-theory.js";
import type { FunctionHost, FunctionImplementation, SpecialForm, Value } from "./types.js";

const implementations: Readonly<Record<string, FunctionImplementation>> = { ...regressionFunctions, ...statisticalTestFunctions, ...randomFunctions, ...timeSeriesFunctions, ...distributionFunctions, ...statisticsFunctions, ...erlangFunctions, ...financialFunctions, ...derivativeFunctions, ...calendarFunctions, ...dateFunctions, ...logicalFunctions, ...textFunctions, ...infoFunctions, ...lookupFunctions, ...databaseFunctions, ...floatingPointFunctions, ...numberTheoryFunctions, ...engineeringFunctions, ...mathFunctions, ...matrixFunctions, ...scientificFunctions, ...complexFunctions, ...conditionalMathFunctions, ...engineeringExtraFunctions, ...romanFunctions, ...specialNumericFunctions, ...complexScientificFunctions, ...reducePiFunctions };
const specials: Readonly<Record<string, SpecialForm>> = { ...statisticsSpecialForms, SUBTOTAL: subtotalSpecialForm, SIMTABLE: simtable, CRONBACH: cronbach, ...financialSpecialForms, ...logicalSpecialForms, ...textSpecialForms, ...infoSpecialForms, ...lookupSpecialForms, ...numberTheorySpecialForms, ...mathSpecialForms, ...complexSpecialForms, ...conditionalMathSpecialForms, ...engineeringExtraSpecialForms };

/** Descriptor checks and argument evaluation are shared by every command/SDK calculation. */
export function callFunction(name: string, nodes: Parameters<SpecialForm>[0], host: FunctionHost): Value | undefined {
  const special = specials[name];
  if (special) return special(nodes, host);
  const optional = host.context?.runtimeFunctions && Object.hasOwn(host.context.runtimeFunctions, name) ? host.context.runtimeFunctions[name] : undefined;
  const implementation = optional?.implementation ?? implementations[name], descriptor = optional ?? functionDescriptors[name];
  if (!implementation || !descriptor || descriptor.signature === null) return undefined;
  const signature = descriptor.signature, pipe = signature.indexOf("|");
  const minimum = pipe < 0 ? signature.length : pipe, types = signature.split("|").join("");
  if (nodes.length < minimum || !optional?.rest && nodes.length > types.length) return error("#N/A");
  const args: (Value | undefined)[] = [];
  let height = 0, width = 0;
  const iteration = new Set<number>();
  for (let index = 0; index < nodes.length; index++) {
    host.tick(); const type = types[index] ?? (optional?.rest ?? "?");
    let value: Value | undefined = host.evaluate(nodes[index]!, type === "A" || type === "r", type === "A" || type === "r" || !!optional?.rest && type === "?");
    if (type === "A" || type === "r") {
      if (value.kind === "error") return value;
      if (type === "r" && value.kind !== "range" && value.kind !== "matrix") return error("#VALUE!");
    } else if (type !== "?") {
      if (host.array && (value.kind === "matrix" || value.kind === "range")) {
        const rows = value.kind === "range" ? value.sheets.length * (value.lastRow - value.firstRow + 1) : value.rows.length;
        const columns = value.kind === "range" ? value.lastColumn - value.firstColumn + 1 : value.rows[0]?.length ?? 0;
        if (height && (height !== rows || width !== columns)) return error("#VALUE!");
        height = rows; width = columns; iteration.add(index);
      } else {
        value = host.scalar(value);
        if (index >= minimum && index < types.length && value.kind === "blank") value = undefined;
        else {
          const converted = coerce(value, type, host);
          if (converted.kind === "error" && type !== "E") return converted;
          value = converted;
        }
      }
    }
    args.push(value);
  }
  if (!iteration.size) return implementation(args, host);
  if (height * width > host.context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
  const matrices = new Map([...iteration].map(index => [index, host.matrix(args[index]!)]));
  const rows = Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, column) => {
    host.tick(); const current = [...args];
    for (const index of iteration) {
      const value = matrices.get(index)!.rows[row]?.[column] ?? error("#N/A");
      const type = types[index] ?? (optional?.rest ?? "?");
      const converted = coerce(value, type, host, true);
      if (converted.kind === "error" && type !== "E") return converted;
      current[index] = converted;
    }
    return host.scalar(implementation(current, host));
  }));
  return admitMatrix(rows, host);
}
function coerce(value: Value, type: string, host: FunctionHost, iteration = false): CellValue {
  const scalar = host.scalar(value);
  if (iteration && type === "s") {
    if (scalar.kind === "blank") return { kind: "string", value: "" };
    return scalar.kind === "string" || scalar.kind === "byte-string" || scalar.kind === "error" ? scalar : error("#VALUE!");
  }
  if (!iteration && type === "b" && scalar.kind === "string") {
    const boolean = asBoolean(scalar); return boolean === undefined ? error("#VALUE!") : { kind: "boolean", value: boolean };
  }
  if (type === "b" || type === "f") {
    if (scalar.kind === "error") return scalar;
    if (scalar.kind === "string") {
      const n = matchNumber(scalar.value, host); return n === undefined ? error("#VALUE!") : numericResult(Number(n));
    }
    if (scalar.kind === "blank") return numericResult(0);
  }
  return scalar;
}
