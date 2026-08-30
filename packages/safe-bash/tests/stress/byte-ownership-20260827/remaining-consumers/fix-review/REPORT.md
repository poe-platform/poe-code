# Independent verifier: two retained-byte copies

## Recommendation

Accept **only the two explicit retained-copy changes** in source/canonical-test
commit `b282159921ce530e932b02f90c64eca987de2704`. No additional product change was
needed or made by this verifier. This is not a full release gate, all-command
certification, native-curl parity, deployed-backend evidence or superiority claim.

## Frozen independent evidence

- Fixture freeze: `07341c4751d776ee258bcea6086bb216216dd7c2`, before author edits.
- Baseline committed candidate: `541f275843c2d06ab78500f559898e766973031a`.
- Baseline evidence: `d1532509`; **26/34 pass, 8 fail**.
- Fixed candidate evidence: `76fe3b86`; **34/34 pass, 0 fail**.
- Matrix, vectors and byte-authentication loader are byte-identical to the freeze.
- The first baseline setup attempted repository self-resolution. Its explicit
  import assertion rejected execution before any row ran. Driver-only correction
  `166f4782` adds a private consumer package boundary; raw rejected-attempt logs
  and the original frozen driver remain preserved. No assertion was rebaselined.

The 34 rows comprise twelve 307/308/configured-503 replay permutations, eight
curl policy/limit/cancellation guards, eight jq program-reader/stdin permutations,
and six jq source/input limit, typed-reader-error, UTF-8 and cancellation guards.
The eight baseline failures are Buffer-backed jq program reads under JSON, raw,
null and pipeline input; Buffer mixed stdin/VFS curl bodies under 307, 308, 503
and cross-origin replay. Native Uint8Array controls and all other guards pass.

Each successful replay compares the entire binary upload at both requests,
authorization metadata, method, stream-open count and response disposal count.
The cross-origin case also checks removal of credentials and custom headers.
Limit/denial rows assert suppressed output and numeric curl diagnostics; their
outer pipeline correctly returns the downstream relay status. Jq checks exact
outputs, source-limit/error diagnostics and program-before-input precedence.
Cancellation compares exact reason identity and checks cooperative fixture work
has retired; it does not demand opaque-host barriers or rollback.

## Authentication

Each candidate was extracted from its exact Git commit and compiled in an owned
isolated source tree with the existing TypeScript installation. No root build,
configuration or dependency file was edited. The built product was npm-packed,
its tarball moved, and that tarball extracted into a distinct consumer package.
Both public-root/network import resolution and 173 loaded product modules were
authenticated against package bytes. Complete source/build/package inventories
before and after are in the per-phase authentication JSON, with immutable
fixture digests and live-source snapshots separately classified.

Tarball SHA256:

- Baseline: `a3d633a41b5d126f04ff2f46098deb61ac49c0c2020847a53f59dd4c07145959`
- Fixed: `1b147c8e7854615b03db5eaedbfa1926f9dafc3fa95e91b0d1e0564af95b2c8e`

Source SHA256, before → after:

- `src/commands/network/body.ts`:
  `29a8a744b043447eacc09d09ca651f2b0a34bdf08e08ddf3065729dbc486edbf` →
  `93d8a8463ac7df91c8ef88368f2ee8524a0abd7e7970badf4d1312587a34c880`
- `src/commands/structured/jq.ts`:
  `feca27d38a096931faabe5a5449ecc65c39c8b0abbcf69d3ea73a31f729fdbac` →
  `096897bfa9d875ba524cebd6b3959c551a26fa5e56d3b0d2fb42f9fabdf80da3`

Independent binding verifies that exactly these two source files differ between
the baseline and fixed inventories; both changes replace retained `slice()` with
`new Uint8Array(chunk)`. Transient forwarding was not changed. The author-ready
marker matches this exact candidate and these hashes. Author-reported 18/18
canonical, 89/89 nearby and scoped TypeScript results are preserved separately
in `evidence/candidate-binding.json`, not counted as independent reruns. It also
records the committed canonical-test hashes and complete source/build manifest
digests. Unrelated concurrent live `execution.ts`/`env-split.ts` edits are not
part of either isolated committed-source candidate.

## Original fixture candidate replays

Adapter commit `b494675c` replays original fixtures as **separate candidate
cohorts**, without changing their text, expected vectors or historical source
pins. Both original historical reports/results remain intact.

- Original packed24 against the fixed package: **23/24 pass, 1 fail**.
  The unchanged jq cooperative-abort fixture still expects yielded/unchangedChecks
  1/1; actual counts remain 2/2, with resumed 1 and finalized true. Its failure
  remains visible in raw TAP. **Original packed24 is not accepted.**
- Original directcurl2 against the fixed package: **2/2 pass**.
  The unchanged TypeScript fixture is transpiled with existing TS 5.9.3, and an
  explicit loader rebinds its historical relative public-root source import to
  the authenticated moved package. This is a candidate packed-adapter cohort,
  not a rerun certified by its old source pins.

Only potential diagnostic marker writes are redirected to this verifier's owned
scratch tree. Assertions and abort fixtures are not migrated or softened. The
replay evidence includes original/copied fixture hashes, loaded-module hashes,
package hashes, zero skipped/cancelled/todo counts and direct transport cleanup.
These 26 historical rows do not enlarge or replace the frozen 34-row matrix.

## Cleanup and limits

All exact build/pack/test children exited; strict unhandled-rejection mode was
enabled for every scored test child. Every independent shell is disposed in
finally, every opened cooperative input/VFS stream is finalized, transports have
zero active work, and every returned completed response is disposed. No network
server or external network was used. No broad process kill or foreign staging
operation occurred. Owned `.work` artifacts remain for reproduction only.

No real transport/provider, arbitrary concurrent buffer mutation, transfer/lease
contract, rollback, full native retry semantics, benchmark or broad typecheck
is claimed. The tests use documented supported 503 retry behavior and preserve
the weaker lifecycle guarantees for uncooperative host work. New holdouts and
evidence stay exclusively under this directory; product source was read-only.
