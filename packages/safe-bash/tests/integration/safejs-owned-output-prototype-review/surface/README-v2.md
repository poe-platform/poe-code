# Current surface preparation: version 2 static seal

**PREPARED ONLY; ROOT receipt-review release is still required.** Eight
unconditional guest inputs plus one conditional finite marker are frozen;
none has executed. Product runtime imports, private engine imports, builds,
installs, and current private checkout queries are all zero.

Read `README.md`, `RUNNER-PLAN.md`, `PINS.json`, and `CASES.json` for the bounded
cohort and actual API. Their bytes and every guest input remain unchanged from
`FREEZE.json`. This version changes only the static check's treatment of one
identified read-only OS tool alias. It does not revise any runtime expectation.

## Preserved first failure

The first check (`verify-prepared.mjs`) exited 1 before any runtime import:
`/usr/bin/tar` resolves to `/usr/bin/bsdtar`. The checker had incorrectly
applied the regular-copy no-symlink rule to that previously pinned OS command
alias. All candidate, package, engine-copy and copied-tool inventory assertions
preceding this final native-tool check had completed; that incomplete attempt
is not reported as a successful static seal. Its raw stdout, stderr, exit status,
stack and parent deadline remain in `static-check-failure-01.json`.

The failure was reported before correction. `TOOL-RESOLUTION.json` pins both
the alias link text and canonical regular OS binary, whose SHA256 is identical
to the earlier tar tool pin. `verify-prepared-v2.mjs` requires exactly that
resolution, still verifies the binary hash, and leaves every copied-file and
module-path symlink rule intact. Neither OS tar entry is executed. There is no
source/private guard change, new dependency, modified prepared input, or live
source overlay. The original checker and original freeze are retained intact.

## Static verification and release

Current command (builtin reads/hashes and bounded public Git reads only):

`node tests/integration/safejs-owned-output-prototype-review/surface/verify-prepared-v2.mjs`

`FREEZE-v2.json` authenticates the original frozen files, the preserved failure,
the explicit tool resolution, this note, and the versioned checker.
`static-check-v2.json` records its raw result. It is not a guest, parser, private
import, public-package runtime, lifecycle, or production-gate result.

The separate receipt verifier's authentication and ROOT's explicit release
remain prerequisites. Fresh private before/after guards, actual imports and
host positive premises, all field-level runtime results, and later child/handle
cleanup are pending. Unsupported reflection remains a declared limit, not a
blanket non-leak assertion. No companion lifecycle expectations were read.
This reviewer stops after committing this preparation; no polling or background
wait is authorized.
