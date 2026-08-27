# Canonical metadata/table prerequisite qualification

This bounded dev-only runner covers the 20 metadata and two table-text native
prerequisite failures routed from `tests/integration/full-gate-20260827/REPORT.md`.
It does not change native assertions, corpora, oracle pins, production code,
root configuration, SGID feasibility results, or another reviewer's evidence.

## Preserved observations

`original.json` preserves all **22 original prerequisite failures and the one
old author-provenance failure**, including complete original diagnostics,
original test text, current pre-edit test text, captured Git blobs/SHA-256s,
source/input hashes, environment, argv and the current unmodified test output.
The original gate revision is `e36dab2b6abc216ddc89e5786a0eba76f08a1722`.
All eleven affected test files were byte-identical to that revision when this
leaf captured them. Product source is current, not represented as frozen e36dab2.

With the existing native assets, those unchanged files execute **318 tests:
317 pass, one fail, zero skip/TODO/cancellation**. The remaining failure is the
old latest-author-file invariant. All **20 metadata + 2 table native rows pass**
without an environment or native-test edit; the table batches actually execute
all **71 + 216** original native fixture rows. The 318 tests also include product
and provenance rows; it is not a count of native fixtures or independent coverage.
`evidence/before-provenance.json` repeats that result using the qualifying runner.

Classification of each routed prerequisite row is retained by name/path in
`original.json.failures`. Eighteen metadata rows execute native tools; the other
two authenticate native source and archive/binary identities. The human-time
row additionally requires GNU touch and a second, distinct GNU stat build.
The two table rows require archive/manual, paste/comm/join, and (for original216)
comm source. None of the original missing-file/126 results measured utility
semantics. They remain recorded failures of that unprovisioned gate.

## Explicit qualified setup, no download/build

Run from the repository root:

```sh
LC_ALL=C LANG=C TZ=UTC node tests/commands/metadata-stress/canonical-env/runner.mjs check
LC_ALL=C LANG=C TZ=UTC node --test tests/commands/metadata-stress/canonical-env/setup.test.mjs
LC_ALL=C LANG=C TZ=UTC node tests/commands/metadata-stress/canonical-env/runner.mjs release
```

An optional final `new-name.json` argument records immutable output through
`apply_patch` under this directory's `evidence/`; existing evidence is never
overwritten. The runner without that argument does not require `apply_patch`.
The runner uses Node builtins and the repository's existing tsx development
installation. It writes no root dist, downloads nothing, installs nothing and
does not build or mutate native assets. Its child tests keep their existing
scratch behavior. In particular, the 71-row table helper leaves its own new
`.native-*` directories; no existing/unattributed scratch was removed.

This is a **GNU coreutils 9.7 / Darwin arm64 local-build profile**, not GNU/Linux
and not Apple utility parity. The observed host is Darwin 25.4.0 / Node 22.22.2.
GNU release source/archive pins, the manual and all eight executable identities
are independently checked before any version invocation. There are **15 assets**:
14 under `tests/commands/metadata-stress/.oracle`, plus the historical second
stat executable. `evidence/setup-positive.json` records every exact path, hash,
version stdout/status and the environment. The original evidence files that
supply pins are themselves checked against the preserved pre-edit hashes.

Every native/test subprocess receives explicit `LC_ALL=C`, `LANG=C`, `TZ=UTC`
and `PATH=/usr/bin:/bin`; inherited locale, Node options and shell startup
variables are not forwarded. Existing helpers further constrain their own
native subprocesses. Current source and installed tsx are hashed before/after;
tracked dirty state and HEAD are recorded separately. No timing comparison is
inferred. Release execution is serial, bounded by 180 seconds and 32 MiB output.

`evidence/setup-controls.json` retains an initial **Node launcher SIGSEGV** with
an intentionally invalid locale before any test could execute; it is not a pass.
Do not rely on the host's locale even to launch Node: use the explicit C/UTC
prefix above (and for npm in release automation). The subsequent five-control
run starts Node in C/UTC, then sets hostile inherited variables inside its last
test before qualifying real native subprocesses. This tests environment
isolation without claiming to repair Node's pre-JavaScript locale startup.

Missing, wrong-hash, wrong-host or unexecutable assets produce
`setup-unavailable`, **exit 78, zero tests executed**. This is neither a product
failure nor a pass/skip. After qualified setup, genuine test failures remain
exit 1. A scoped success requires **318/318, zero real skips/TODO/cancellation,
all 22 routed native rows present and passed, and unchanged source/input hashes**.
No test-name filters or skip annotations are introduced.

The old human-time test deliberately retains its second stat build at:
`/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/stat`.
Its pin is `bf6f8514f2a220a3c3743154e0530baeec864b9d1f20315cd9cb5832d28c9860`.
That binary is used read-only. This is an explicit host-specific prerequisite,
not a portable provisioning recipe. If it is gone, this exact profile is
unavailable: do not substitute the primary stat or claim passing verification.
No unapproved network rebuild or path relocation is performed. The recorded
configure command alone does not guarantee identical locally built binaries.

## Exact additive request for Plato

Root manifests/scripts and full-gate preparation remain root-owned. Add a
separate script named `verify:metadata-table-native` with this exact value:

```text
node tests/commands/metadata-stress/canonical-env/runner.mjs release
```

Require it as a non-optional release-verification step; neither `|| true`, skip,
nor treating exit 78 as green is permitted. Do not replace the global gate with
this scoped command. Add `node --test
tests/commands/metadata-stress/canonical-env/setup.test.mjs` as the separate
dev-only setup-control job (the root npm test glob selects `.test.ts`, not mjs).

For a frozen archive on this qualified host, explicitly copy only the 14 local
assets listed by `runner.mjs check` into the archive at the corresponding
`tests/commands/metadata-stress/.oracle/...` paths. Preserve executable modes;
compare source/destination SHA-256s against the recorded pins. The second stat
must still exist at its recorded absolute location, with its distinct pin.
Run `check` **inside the archive** before the mandatory release command. Do not
silently add an ignored-cache overlay or use host source for product imports.
Record archive revision, overlay manifest/hashes, setup and exact TAP counts.
The old no-overlay gate and all its failures must remain visible.

No qualifying recipe for an arbitrary Linux/Darwin machine is claimed. Such
portability needs a separately authorized reproducible native build/profile or
a narrowly reviewed relocation mechanism; it is not necessary to alter the
currently passing native tests to fix these routed missing-cache failures.

## Primary references, not replacement oracles

- `https://git-scm.com/docs/git-rev-parse`: `<revision>:<path>` names the
  historical blob/tree. Actual local object hashes, not documentation, bind
  the captured source here.
- `https://www.gnu.org/software/coreutils/faq/coreutils-faq.html`: locale
  collation is host-provided; `LC_ALL=C` forces the standard locale behavior.
  Runtime comparisons remain pinned to local 9.7 binaries, not the newer
  online manual, and GNU-on-Darwin is not relabeled GNU/Linux.
