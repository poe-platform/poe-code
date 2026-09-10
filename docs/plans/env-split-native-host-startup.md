# Native startup for env split host qualification

The full maintained unit run failed the blocked-input cancellation, sink-cancellation
precedence, and repeated-row isolation cases at their four-second child deadline.
The unchanged focused cases passed in 1.73, 1.55, and 1.67 seconds. A separate
measurement spent 989 ms importing the source public API through TSX, versus less
than 7 ms constructing and disposing the full default shell.

Use a native JavaScript host importing the complete built public entry. Preserve
all 25 scenarios, repeated-row isolation, assertions, real child processes,
process-group teardown, four-second child limits and six-second test limits.
The new host is the type-erased original with only its public import redirected
from src/index.js to dist/index.js. Keep the TypeScript host for historical source
reproduction. No runtime behavior, command subset, profile flag or execution cache
is introduced.

The supported root npm test route declares the virtual-bash build dependency and
finishes that build before unit execution. Direct focused invocation requires a
fresh package build after source changes; a missing built entry fails with Node's
module-not-found error. This change does not authenticate arbitrary pre-existing
dist contents or claim that a direct invocation detects stale output.

The dated resume-verify script archives source without building dist. It therefore
uses the source-host test parent from public commit
18c36c54bb6509a97c600375dac4a7384589e9fa, recording that commit and its SHA256 in
each new report. Its bytes matched the current parent before this change:
f92b1c39e1e04da2a8371852d62255e9acfe1a13ca227b9f00a59b597079e4fb.
Existing receipts and seals remain unchanged. The separate historical core-verify
script already references a missing resume-seal.json; it is not qualified here.

Validation: compare the original type-erased and native runtime ASTs, verify the
pinned parent bytes, then run every maintained scenario and the three previously
failing selectors with unchanged deadlines. Prior independent native-child probes
passed the exact three scenario bodies in 490, 396 and 363 ms. Evidence is retained
in /tmp/poe-env-native-exact-diagnostic.log and /tmp/poe-env-public-api-parity.log;
the latter confirms 190 public exports, 110 commands and shared filesystem identities.

Completed validation on the reconciled checkout:

- Unfiltered host file: 29 passes across all 25 scenarios, their finite-batch
  subtests, and repeated-row isolation; 6.651 seconds total. No skipped cases.
  Log: /tmp/poe-env-native-host-green.log.
- Filtered route (`--test-name-pattern='env split'`): all 25 individual scenarios
  plus repeated-row isolation passed, 26/26 in 10.956 seconds. No skipped cases.
  Log: /tmp/poe-env-native-host-selectors-green.log.
- Type-erased runtime body and import comparison passed; public parent pin bytes
  match the pre-change parent. Log: /tmp/poe-env-native-host-equivalence.log.
- Historical driver syntax and git diff whitespace checks passed. The historical
  archive driver itself was not rerun; no old evidence is represented as current
  acceptance, and no full-suite pass is claimed by these focused checks.
