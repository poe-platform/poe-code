import { boundedText, numberArg } from "./functions/common.js";
import type { RuntimeFunctions } from "./runtime-functions.js";
import { numericResult } from "./values.js";
import { callFunction } from "./functions/registry.js";
import { snapshotRuntimeFunctions } from "./runtime-functions.js";
import { localNow } from "./functions/dates.js";
import { pythonCapwords } from "./functions/python-capwords.js";
import { perlSed, type PerlSampleVersion } from "./functions/perl-sed.js";
import { pythonPrintf } from "./functions/python-printf.js";
import { pythonUnicodeProfiles, type PythonUnicodeVersion } from "./functions/python-unicode-profile.js";
import { SsconvertError } from "../contracts.js";

/** Original JS ports of the released Perl sample, enabled only by explicit injection. */
export type { PerlSampleVersion } from "./functions/perl-sed.js";
export function createPerlSampleFunctions(options: { readonly version: PerlSampleVersion }): RuntimeFunctions {
  const version = options.version;
  if (version !== "5.34.1" && version !== "5.40.1")
    throw new SsconvertError("invalid-request", "Unsupported Perl version: " + version);
  return snapshotRuntimeFunctions({
    PERL_ADDER: { signature: "ff", implementation(args, host) {
      return numericResult(numberArg(args, 0, host) + numberArg(args, 1, host));
    } },
    PERL_SED: { signature: "sss", implementation: (args, host) => perlSed(args, host, version) },
    PERL_DATE: { signature: "", implementation(_args, host) {
      const date = localNow(host);
      const year = date.year;
      const formattedYear = year < 0 ? `-${String(-year).padStart(3, "0")}` : String(year).padStart(4, "0");
      return boundedText(`${formattedYear}${String(date.month).padStart(2, "0")}${String(date.day).padStart(2, "0")}`, host);
    } }
  });
}
export const perlSampleFunctions: RuntimeFunctions = createPerlSampleFunctions({ version: "5.34.1" });

/** Select frozen Python Unicode rules for capitalization and percent-format representations. */
export function createPythonSampleFunctions(options: { readonly unicodeVersion: PythonUnicodeVersion }): RuntimeFunctions {
  if (!Object.hasOwn(pythonUnicodeProfiles, options.unicodeVersion))
    throw new SsconvertError("invalid-request", "Unsupported Python Unicode version: " + options.unicodeVersion);
  const profile = pythonUnicodeProfiles[options.unicodeVersion];
  return snapshotRuntimeFunctions({
    PY_PRINTF: { signature: "", rest: "?", implementation: pythonPrintf.bind(null, profile) },
    PY_CAPWORDS: { signature: "s", implementation: pythonCapwords.bind(null, profile) },
    PY_BITAND: { signature: "ff", implementation(args, host) {
      const nodes = args.map(value => ({ kind: "literal" as const, start: 0, end: 0, value: host.scalar(value!) }));
      const result = callFunction("BITAND", nodes, host);
      if (result === undefined) return { kind: "error", value: "#NAME?" };
      const value = host.scalar(result);
      // The native Python bridge converts a delegated Gnumeric error to None.
      if (value.kind === "error") {
        host.diagnostic?.({ code: "python-loader", severity: "warning", message: "gnm_value_to_py_obj: unsupported value type" });
        return { kind: "blank" };
      }
      return value;
    } }
  });
}

/** The Python sample resolves Gnumeric's BITAND, rather than Python's integer &. */
export const pythonSampleFunctions: RuntimeFunctions = createPythonSampleFunctions({ unicodeVersion: "16.0.0" });
