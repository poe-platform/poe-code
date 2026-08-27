# DU author checks

Source/plugin boundary only; root and package DU exports are owned separately.

Run focused checks without modifying shared builds:

```
node --import tsx --test tests/commands/du/*.test.ts
node_modules/.bin/tsc -p tests/commands/du/tsconfig.json
node tests/commands/du/capture-checks.mjs
node --import tsx tests/commands/du/capture-comparison.mjs
node tests/commands/du/capture-native.mjs
```

The capture commands explicitly create unique owned `evidence/` directories.
Canonical tests never rewrite committed captures. Native and Real fixtures are
created only below this DU test directory and removed in finally/test cleanup.
The shared GNU 9.7 binary/source is read-only; no native build/install is used.
The live native test skips, explicitly, if that binary is absent and rejects a
changed binary. BSD is never substituted. The native corpus is GNU on Darwin,
not GNU/Linux or deployed-provider acceptance.

`native-profile.json` is classified native fixture data, copied byte-for-byte
from the original 87-case capture. It contains original GNU stdout/stderr/status,
fixture sizes, platform/version and binary/source hashes; it is not product
source or a current-implementation byte pin. Every case is exercised by current
tests, including divergent cases. Diagnostic differences have exact product
expectations, with original GNU errors retained; no blanket assertion weakening.

The suite covers actual Shell option/reporting behavior, strict allocation
unknown/invalid handling, trusted-identity aliases, incomplete totals, metadata
errors, arithmetic and resource bounds, cancellation, backpressure, registered
cleanup, and direct/built module boundaries. Provider tests use Memory, rooted
Real, read-only, mount, overlay, S3 MockS3Client, and WebDAV MockDav. Remote tests
are actual adapter-plus-mock workflows, not live service acceptance. Trace tests
reject every command-issued FS method except `lstat` and `readdir`.

The named RED Overlay control is green only when it **detects the known provider
no-effects failure**: pending staging garbage is deleted by adapter-internal
housekeeping on a command-issued `readdir`. This is not all-adapter no-effects
acceptance and does not authorize a provider change. It remains separate from
the strict command-boundary trace property.

`capture-checks.mjs` records live source hashes, git state, raw logs and original
path postchecks. It is not a frozen archive gate; unrelated concurrent edits can
appear in status. It does not claim append-proof integrity. Isolated builds are
temporary and test the built-module/plugin interface, never a public package DU
subpath or root import. `capture-comparison.mjs` preserves raw mismatches as well
as exact and record-normalized comparison counts. Author green is not independent
review, a whole-repository gate, superiority, or project completion.

See `evidence/REPORT.md` after the separate evidence checkpoint for captured runs
and the exact source commit to which they refer.
