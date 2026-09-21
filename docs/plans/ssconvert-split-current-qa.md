# Current split/template candidate QA

1. Authenticate `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` using SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Inspect `resolve_template`, `do_split_save`, and GOOffice `go_shell_arg_to_uri`.
   Use the dependency/plugin/locale capture in
   `docs/ssconvert/sheet-selection-and-range-profile.json`. Attempt Docker oracle
   discovery; record an unavailable daemon as unverified native coverage.
2. Run the original local-file URI regression red before repair. Then run the
   independent review cases, including direct-I/O negative controls for refused
   authorities, encoded separators, NUL, malformed escapes and first-save effects.
3. Run uncached maintained ssconvert test, lint, and selected workspace build
   routes. Run Safe Bash ssconvert integration tests with TSX caching disabled,
   including shared command/SDK canonical URI artifacts and namespace effects.
4. Manually invoke the built shared command engine with a small original
   in-memory sheet codec, `-S`, and a `file://localhost/missing/../out-%n.csv`
   template. Capture the command's exit status, diagnostics and artifacts using
   `npm run screenshot -- -o out/ssconvert-split-current.png node ...`; inspect
   the rendered transcript. No native product dependency or fallback is allowed.
5. Record candidate hashes and final results separately from historical evidence.
   Do not treat native unavailability, renderer ordering, multibyte unknown
   substitutions, full repository gates or unexecuted runtime cells as passes.
   Preserve prior edits; do not change README files, push or publish.

## Current results

The archive hash above was freshly verified. Docker discovery failed because
the daemon socket was unavailable; fresh native differentials were not run.

The original canonical URI regression failed before repair. Independent review
then reproduced two denied-authority bypasses introduced by canonicalization;
both were repaired after their red run by retaining malformed authorities for
injected I/O refusal. Independent unchanged split suites: 30/30 pass.

Final maintained checks on the dirty candidate based on Git HEAD
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`:

- `npm run test --workspace=@poe-code/ssconvert -- --no-cache`: 236 files,
  5324 tests pass; completed in 32.90 seconds. This is semantic coverage, not a
  performance qualification.
- `npm run lint --workspace=@poe-code/ssconvert`: exit 0 (ESLint and source/test
  TypeScript checks).
- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`:
  exit 0 for the declared selected closure.
- `TSX_DISABLE_CACHE=1 node --import tsx --test
  packages/safe-bash/tests/commands/ssconvert.test.ts`: final 57/57 pass. The first
  new integration run had 56/57 pass because its assertion omitted the shell's
  stdoutBytes/stderrBytes fields. Correcting the assertion, without a product
  change, produced the completed final 57-case gate.
- Safe Bash ESLint for the changed integration test: exit 0.
- Built shared command engine manual screenshot: inspected canonical
  `file:///out-0.csv` and `file:///out-1.csv`, Unicode payload, no diagnostics,
  exit 0. The screenshot font displayed the Unicode payload as a missing glyph;
  Unicode bytes/filenames are verified by unit/integration cases, not visually
  certified by this capture. Capture used the generic screenshot route because this is a virtual
  command rather than a poe-code CLI command. Owned temporary captures/logs are
  purged after inspection.

Candidate SHA-256:

- split.ts: `fc377cbe0517a0d7dff9b61af99867237556e0ef9e314b64782cf4293ede4d2a`
- split.test.ts: `908a9b1e2e19cf8b0533663d6fecbd8496c39e2a21a92ff2f8a2ed241e87b261`
- split-current-review.test.ts:
  `faaff881a44f78092123d0e33a2cabc4187f3508f7a9331608b05e9554232200`
- Safe Bash ssconvert.test.ts:
  `b530133368345a258494634b7b7b941bb915e8002d7300adf46a42957972c284`

Remaining mismatches/unverified coverage: C-byte consumption of multibyte unknown
substitutions versus JavaScript code units; renderer-provided graph anchor order;
legacy URI-only graph artifacts without sheet/object identity; unsafe scheme
mapping refusals remain capability divergences. Fresh native/plugin/locale matrix,
realm/host provider containment, checkpoint/replay specifically for this URI
change, and full repository gates were not measured by this narrow qualification.
Existing integration replay cases passed but do not qualify every new URI variant.
Malformed-authority native behavior is unmeasured; preserving direct-I/O denial
is a verified negative authority control. No skips within completed test gates,
no incomplete test runs, and no remaining failures in the listed gates. No local
commit, push, remote-main delivery, publication or release was performed.
