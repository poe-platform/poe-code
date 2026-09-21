import { boundedText, numberArg, textArg, unsupported } from "./functions/common.js";
import type { RuntimeFunctions } from "./runtime-functions.js";
import { numericResult } from "./values.js";
import { callFunction } from "./functions/registry.js";
import { snapshotRuntimeFunctions } from "./runtime-functions.js";

/** Original JS port of the released sample's typed ff addition; other Perl services remain unresolved. */
export const perlSampleFunctions: RuntimeFunctions = snapshotRuntimeFunctions({
  PERL_ADDER: { signature: "ff", implementation(args, host) {
    return numericResult(numberArg(args, 0, host) + numberArg(args, 1, host));
  } }
});

/** The Python sample resolves Gnumeric's BITAND, rather than Python's integer &. */
export const pythonSampleFunctions: RuntimeFunctions = snapshotRuntimeFunctions({
  PY_CAPWORDS: { signature: "s", implementation(args, host) {
    // string.capwords splits on whitespace and capitalizes whole words, not punctuation-delimited names.
    // Unicode tables depend on the qualified Python runtime; do not substitute ECMAScript casing.
    const source = textArg(args, 0, host);
    let result = "", wordStart = true;
    for (const char of source) {
      host.tick();
      const code = char.codePointAt(0)!;
      if (code > 127) unsupported("PY_CAPWORDS Unicode whitespace/capitalization");
      if (char === " " || (code >= 9 && code <= 13) || (code >= 28 && code <= 31)) {
        wordStart = true;
        continue;
      }
      if (wordStart && result.length > 0) result += " ";
      result += wordStart ? char.toUpperCase() : char.toLowerCase();
      wordStart = false;
      if (result.length > host.context.limits.outputBytes) return boundedText(result, host);
    }
    return boundedText(result, host);
  } },
  PY_BITAND: { signature: "ff", implementation(args, host) {
    const nodes = args.map(value => ({ kind: "literal" as const, start: 0, end: 0, value: host.scalar(value!) }));
    const result = callFunction("BITAND", nodes, host);
    return result === undefined ? { kind: "error", value: "#NAME?" } : host.scalar(result);
  } }
});
