# Independent expr holdout freeze

This is an opt-in, candidate-independent freeze, not product acceptance. Ownership
is only this new directory. Source, author tests, root exports/configuration and
other workers' files are read-only. No author expr implementation, new tests or
expected answers were consulted. No subagent was used. Initial source baseline:
`b67eabd289997b2daf8b9cf04dd48aea9cb48282`. The initial Git status had no expr
candidate paths; concurrent author paths may appear in the later capture status.
That does not make this a temporally sealed archive of an absent future candidate:
independence here means inputs and expectations were not derived from that work.

## Frozen scope and denominators

- 95 deterministic literal argv cases, including 9 encoding cases; no random seed
  or generated cosmetic multiplication. Five cases are positive coding workflows.
- GNU 9.7/Darwin/C: all 95; GNU 9.7/Darwin/en_US.UTF-8: 9 encoding cases.
- Apple/Darwin/C: all 95; Apple/Darwin/en_US.UTF-8: the same 9 encoding cases.
- Total: 208 native observations, not 208 independent features. The GNU normative
  cohort is 104 observations. Apple never replaces a failing GNU result.
- 16 product-independent safety/control specifications and 7 actual-Shell workflow
  specifications are frozen separately in `controls.json`; none is a measured pass.
- `inputs.json` is the exact input inventory. `oracle.json` preserves stdout/stderr
  as base64, exact status, failure/signal, each case hash and UTF-8 argv hex.

GNU semantic comparison means exact stdout bytes and status plus diagnostic
presence. Exact stderr bytes are a separate diagnostic column. Strict agreement
requires both; no diagnostic is normalized or discarded. The semantic column
alone does not prove diagnostic category correctness. All mismatches keep original
observations. Resource refusal and Unicode-policy differences are separate named
classifications, not licenses to remove native rows or call unsupported rows passes.

`primary-sources.json` records current official GNU guidance and authenticated 9.7
source/release hashes. Moving manual pages report newer versions and are not
misrepresented as 9.7 manuals. Tagged 9.7 parser/source and this exact binary settle
version-specific behavior. The official source is not copied into the product.

## Native boundaries

The dev-only GNU binary is
`tests/commands/metadata-stress/.oracle/coreutils-9.7/src/expr`; Apple is `/bin/expr`.
The runner refuses other binary/archive/source hashes, kernel or architecture.
It records actual resolved executable paths, SHA256, logical argv0 `expr`, the
entire --version observation, linked-library listing, macOS build, kernel, Node,
locale/charmap and the entire supplied environment. Apple treats `--version` as
an expression; that output is **not** called an Apple version string.

Each native call is an absolute binary plus literal argv, never a native shell.
All calls have a 2-second deadline, SIGKILL on overrun, a 64-KiB combined output
ceiling, at most 128 arguments and 8-KiB UTF-8 argument bytes including terminators.
The bounded cases are much smaller. Calls run sequentially in one unique empty
owned cwd with stdin ignored, no product process, no input files or network. The
runner checks that cwd stays empty, awaits child close and removes only that cwd.
SIGINT/SIGTERM kills and reaps the current child and prevents further admission.
Native expr stdin ignoring does not prove zero product stdin reads; that requires
the getter/iterator trap control. Helper processes only inspect explicit pins,
locale/build metadata and repository provenance. No tool installation is needed.

No ReDoS probes run in native capture. The four bounded pathological inputs in
`controls.json` MUST be executed only through a required outer Worker watchdog by
the later reviewer. Compile/match must additionally run inside the product's own
bounded worker service; outer containment cannot establish that. Shared-protocol
support/ownership approval may block regex acceptance. Keep every regex holdout
even if that integration is unavailable. Never compile untrusted regex in the
harness main thread, including validation or translation checks.

## Encoding and trust limits

Node encodes well-formed argv strings as UTF-8. Native C-locale byte slicing can
produce invalid UTF-8 output, so base64 is authoritative; do not decode/re-encode
before comparing. The UTF-8 cohort distinguishes scalar values from UTF-16 units
and graphemes. It also preserves a locale-collation probe, not universal Unicode
collation acceptance. Lone surrogates and NUL are only product specifications,
never spawn goldens: those inputs cannot pass faithfully through this string argv
bridge. Arbitrary invalid-UTF-8 argv remains unmeasured. Control bytes other than
NUL are included. No claim covers every locale, arbitrary binary argv or Linux.

The baseline public APIs inspected are `CommandDefinition.execute`, byte
`CommandContext` sinks/source/signal/fs, optional `registerCleanup`/`invoke`, and
`Shell`/`CommandRegistry`/`MemoryFileSystem`. There is no assumed expr export,
default registration or configuration constructor. Root must route a different
reviewer to bind the future real definition, worker protocol and limit options.
Do not invent an integration adapter API or silently substitute a stub Shell.

## Opt-in commands

Run from the repository root. `.mjs.data` deliberately stays outside TypeScript
canonical test discovery; no root test/config/exports integration is added.

```sh
node --input-type=module - verify < tests/commands/expr-stress/frozen/runner.mjs.data
node --input-type=module - verify-native < tests/commands/expr-stress/frozen/runner.mjs.data
```

`verify` only checks manifest-listed bytes and frozen structure, never captures or
writes evidence. `verify-native` checks original integrity before/after bounded
native replay; it prints results without writing committed evidence. Both validate
all frozen case IDs/hashes and original profile denominators. Missing prerequisites
are errors/BLOCKED, never skips credited as passes. Manifest checks do **not** detect
new unlisted entries: this is not append-proof tree certification or a full gate.

Original capture command, intentionally unusable once its directory exists:

```sh
node --input-type=module - capture original-20260827 < tests/commands/expr-stress/frozen/runner.mjs.data
```

For an explicitly requested additional capture, choose a NEW unique label. Capture
refuses existing directories/files and adds both receipt and SHA256 manifest via
`apply_patch`. Never rerun capture into the original directory or rewrite its
goldens to match the product. No normal test or runner default writes goldens.

Future reviewer comparison (report path is a future prerequisite, not produced by
this freeze):

```sh
node --input-type=module - compare tests/commands/expr-stress/frozen/evidence/execution-review/candidate-report.json < tests/commands/expr-stress/frozen/runner.mjs.data
```

The report schema is `{schema:1, freezeManifestSha256, candidate:{commit,
sourceTreeSha256, adapterSha256, dirty}, profiles:[{id, results:[{id, caseSha256,
status, stdoutBase64, stderrBase64, signal:null, failure:null}]}]}`. Supply both GNU
profiles, in original order, every row in original order. Missing/duplicate rows
fail structural validation, not disappear from denominators. Diagnostic and
semantic mismatches are reported separately, with full reference/observed rows.
This is a comparator of independently produced observations, **not** a candidate
execution driver or authentication of its self-reported provenance. Do not feed
native receipts back as candidate evidence. A future execution driver must inspect
and hash actual committed candidate source/tests/adapter, state dirty-vs-frozen
inputs, execute actual handlers/Shell, run controls under watchdogs and record
unsupported profiles honestly. Intentional limits must still retain the original
native mismatch. Regex and safety acceptance remain NOT RUN until that review.

## Validation and handoff

The leaf runs syntax/JSON checks, original capture, immutable verification and one
strict native replay. These checks certify only this bounded frozen evidence.
No product build/tests, author inspection, root changes or product acceptance is
part of this task. The final atomic commit binds inputs, controls, primary-source
receipts, opt-in runner, README and original evidence. The requested separate
`/tmp/expr-independent-freeze-candidate.txt` handoff gives its actual commit, pins,
manifest hash, measured counts and future commands. Actual work is recorded by
receipt/commit timestamps; this task does not establish 72 hours or superiority.
