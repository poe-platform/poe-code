import { boundedText, numberArg } from "./functions/common.js";
import type { RuntimeFunctions } from "./runtime-functions.js";
import { numericResult } from "./values.js";
import { callFunction } from "./functions/registry.js";
import { snapshotRuntimeFunctions } from "./runtime-functions.js";
import { localNow } from "./functions/dates.js";
import { pythonCapwords } from "./functions/python-capwords.js";
import { perlSed } from "./functions/perl-sed.js";
import { pythonPrintf } from "./functions/python-printf.js";
import { pythonUnicodeProfiles, type PythonUnicodeVersion } from "./functions/python-unicode-profile.js";
import { SsconvertError } from "../contracts.js";

/** Original JS ports of the released Perl sample, enabled only by explicit injection. */
export const perlSampleFunctions: RuntimeFunctions = snapshotRuntimeFunctions({
  PERL_ADDER: { signature: "ff", implementation(args, host) {
    return numericResult(numberArg(args, 0, host) + numberArg(args, 1, host));
  } },
  PERL_SED: { signature: "sss", implementation: perlSed },
  PERL_DATE: { signature: "", implementation(_args, host) {
    const date = localNow(host);
    return boundedText(`${String(date.getUTCFullYear()).padStart(4, "0")}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`, host);
  } }
});

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
