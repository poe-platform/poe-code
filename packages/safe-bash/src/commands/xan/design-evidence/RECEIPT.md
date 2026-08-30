# XAN precode author handoff

Scope: design and developer-oracle preparation/observation only. This leaf did
the work directly without redelegation. No product implementation/test, registry,
public export, package/config/AGENTS/shared-contract/runtime/private checkout edit.
No native product fallback, runtime dependencies or system tool installation.

## Deliverables and boundaries

- `src/commands/xan/DESIGN.md`: precise proposed module API, command grammar,
  byte dialects, selectors, writer, budgets, ownership, cleanup, VFS publication,
  diagnostics and six root policy decisions. Proposed factories:
  createXanCommand, createXanCommands, xanCommands; options replace/limits; one
  registry definition `xan`, four subcommands headers/count/select/slice, h alias.
- Initial kernel only. Sort/frequency/JSON need kernel review and fresh scope;
  expression evaluation and all other assigned HOLD commands remain excluded.
- `design-evidence/SOURCE-MAP.md`: immutable primary-source reading map and
  license/dependency provenance. `LOCAL-BINDING.json`: 14 read-only local source
  hashes and 44 checked upstream/source/binary paths, with explicit non-append-proof
  limitation. All 14 local inputs match the pre-execution provenance repository
  boundary `0e83ced9ef58f95dc49e1ecbd5d18a7995d9f35f`.
- `tests/commands/xan-oracle-prep-20260828/`: sealed protocol, 28 discovery rows,
  opt-in native-only runner, provenance/licenses and exact raw execution JSON.
  These .md/.json/.mjs files are not canonical `tests/**/*.test.ts` discoveries;
  no raw TypeScript native fixture or configuration exclusion was introduced.

## Source/license and native oracle

Target tag 0.54.0 => `2f9156c8ec79a3ecc09e0879735ac68ec8997b7a`.
Cargo license Unlicense OR MIT; exact MIT notice names Andrew Gallant and Guillaume
Plique (2015–2024). simd-csv 0.9.0 MIT notice names Guillaume Plique (2025).
csv 1.4.0 / csv-core 0.1.13 / docopt 1.1.1 declare Unlicense/MIT. Full exact notices
and hashes are retained, not inferred. All four official crate archive hashes
match the pinned Cargo.lock. No copied Rust product implementation is proposed.

Official Darwin arm64 release archive SHA256:
`fded89ddb5941a848a31e40c966c792754ea38dea6b2771fce02879ef197f6c0`;
matches publisher .sha256 asset. Native executable SHA256:
`2600a522a9a47d079a9ee93eaa4a2f6e4ce541eb381cde7b41ee6c04a6615d46`.
Runtime row 01 outputs exactly `0.54.0\n`. No signature in inspected asset listing;
matching checksum/version is not a reproducible-source-build proof. GitHub release
JSON failed twice with HTTP 504; official expanded-assets HTML succeeded. No build
or toolchain download was necessary; Node v22.22.2, Darwin arm64 kernel 25.4.0.

## Temporal and commit receipt

1. PRE-EXECUTION protocol/source binding:
   `4e2e582847bc3438f3092f963db05d12fc3bc6c5`, committed
   2026-08-28T02:14:56Z. All five protocol paths remain byte-identical to that commit.
2. First native process: 2026-08-28T02:15:03.613Z. Last child close:
   2026-08-28T02:15:04.122Z. Exactly 28/28 rows; 23 status 0, five status 1;
   version/help included. These counts are observations, not pass counts.
3. Separate execution evidence commit:
   `4628da200ba3f79f13a07ea8f5881206f70e6819`.
4. Design handoff is the atomic commit containing this receipt; its hash is
   published afterward in `/tmp/xan-precode-20260828-candidate.txt` and the separate
   `/tmp/xan-precode-20260828-receipt.txt`. No CLI final-output file is written.

Actual work began at 2026-08-28T02:09:56Z; this handoff was prepared around
02:24Z. The assignment's August 28 label is preserved; Chicago local timestamps
are still August 27 during these UTC times. No 72-hour duration claim is made.

## Decisions requiring root policy

1. Fix or emulate native `slice -l 0` (observed all-record output), equal-end and
   zero-tail corner behavior. Proposed safe no-data read is a declared deviation.
2. Approve per-command CR dialect, bounded malformed-quote support, chunk-invariant
   BOM handling and refusal to copy SIMD lookahead artifacts.
3. Decide safe cross-delimiter select normalization vs raw-native transfer.
4. Approve proposed API/caps and strict grammar boundaries (including docopt's
   whitespace-only numeric-to-zero quirk). Defaults include 256 MiB input/output,
   32 MiB retained, 8 MiB record, 4 MiB cell, 16384 columns/selected columns,
   1M records, 16 input files, 4096 selector nodes/tail rows and 1B work units;
   all exact defaults and hard caps are in DESIGN.md.
5. Approve explicitly nontransactional VFS -o, authoritative alias checks,
   unknown-identity refusal, exclusive new outputs, and refusal of existing
   output with borrowed stdin. Normal safe -o cases remain usable.
6. Approve unsupported advanced flags/formats/color/pathological delimiters and
   exact-vs-unqualified diagnostics, then route the DIFFERENT fixture freeze.

## Validation, remaining gaps and cleanup

Validated runner syntax with `node --check`; parsed all retained JSON; verified
row order/argv/count, all close receipts, source/binary hashes and sealed protocol
bytes. `git diff --check` passed for owned paths. No npm build/typecheck/product
suite ran because no implementation was authorized. Frozen source inspection
found meaningful native defects; no original input or observation was rewritten.

All 28 child processes closed and all 28 owned process groups were absent (ESRCH)
after close. No timeout, cap failure, spawned extra native command, surviving
watcher or SIGSTOP child. No shared cache or foreign native artifact was deleted.
Owned OS-temp source/oracle cache retained by explicit user permission at
`/tmp/xan-precode-20260828.X6abEd`, 26176 KiB allocated by `du -sk` at handoff,
to preserve verified binary/source provenance and the release API failure body.
Owned raw execution tree retained at
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/xan-dev-oracle-20260828-IYxIHW`,
84 KiB allocated, to preserve exact isolated cwd/effect evidence. Neither is a
project dependency, a global install or a tracked native artifact.

No independent reviewer fixtures were accessed. No Linux, all-malformed-input,
all-diagnostic, all-provider, cancellation, performance, superiority, public API
availability, full-native-parity or full-project completion claim. Implementation
must await root policy and different-reviewer freeze; this author does not release
that hold. Only explicitly owned paths enter these commits; foreign live/staged
work and concurrently advancing HEAD are preserved.
