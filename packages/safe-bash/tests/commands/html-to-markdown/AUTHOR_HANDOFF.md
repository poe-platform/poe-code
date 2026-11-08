# Standalone HTML conversion author handoff

2026-08-27 18:58 UTC. **Different review required; no public/default integration.**

Production and first canonical tests: `2272feb92f8c0f151385f59f79eee004c50d14b8`.
Additional companion/compiled/reference/control harness: `21ca7b8c`.
Production is unchanged after2272. Root/package/plugin aggregate files were not
edited; html-to-markdown is not a default or root/subpath export. No new runtime
dependency, private checkout access or whole-product gate.

The CLI/rendering/security/budget profile was supplied before implementation;
Meitner's independent fixture freeze is **post-author-source**, not a claimed
pre-source holdout. Detailed durable profile: `src/commands/html-to-markdown/README.md`.

## Module-local stable interface

Import the module-local `src/commands/html-to-markdown/index.ts` (ESM `.js` after
compilation), not an unimplemented package export:

- `createHtmlToMarkdownCommand(options?: HtmlToMarkdownCommandsOptions): CommandDefinition`
- `createHtmlToMarkdownCommands(options?: HtmlToMarkdownCommandsOptions): readonly CommandDefinition[]`
- `htmlToMarkdownCommands(options?: HtmlToMarkdownCommandsOptions): VirtualShellPlugin`
- Types `HtmlToMarkdownCommandsOptions` (`replace?`, `limits?`) and
  `HtmlToMarkdownLimits`. Standalone registration requires no other family.

CLI is `[--] [FILE|-]...`, `--help`, `--version`; ordered VFS/stdin input, one
shared stdin cursor, stdout only. No URL fetching, script execution, raw-HTML
passthrough, filesystem writes or implicit host path. Optional curl is separately
registered/injected; an actual authorized transport→HTML→VFS pipeline is tested.

Default input/output8/16MiB, token/cell/arguments64KiB, tokens200k, nodes100k,
depth128, attributes64/tag, cells10k, files64, work64Mi units, diagnostics8KiB.
Parsing uses a bounded tree and bounded per-operand rendered string before
awaited chunked output: **not constant-memory/immediate-output streaming**.
Limits are charged without resetting across operands. Earlier output can remain
after a later failure; there is no transactional-output claim.

## Actual author checks

- **119/119 canonical tests**, zero failures/skips/TODOs. Four files cover literal
  rendering, malformed/raw/RCDATA input, UTF-8 chunking, entities, URI obfuscation,
  nested structures, bounds, VFS/shared stdin, cancellation, borrowed bytes,
  output backpressure, collision handling, actual shell pipelines and cleanup.
  This includes the injected curl companion and finite downstream-head case;
  it does not close the separate global five pre-first-read requirements.
- **Scoped TypeScript passes**, including strict/exact optional properties. No
  claim about all concurrent authors' global test/type state.
- **Compiled module-local consumers:**4 runtime cases, strict positive types,
  3 exact negative-type cases, source-read denial and missing-emitted-module
  refusal. Node22.22.2 binary/hash is recorded. All21 compiled production inputs
  match2272,84 emitted files match before/after. The missing-module control
  deliberately renames/restores one emitted entry; this is not a zero-write
  claim. Runtime loads only the emitted tree under filesystem permission fences.
  These are not npm-packed public root/subpath checks: that integration is held.
- **Three author negative controls:** baseline3/3; scheme-policy bypass, input
  charge removal, and cleanup-registration removal each fail their assertion in
  a copied2272 source tree. No production mutation or broad mutation-score claim.
- Execution trees are removed; native and controlled child processes exited.
  Captures use unique OS-temp directories. Canonical tests do not rewrite this
  evidence. No local HTTP server or real provider credentials were needed.

## Preserved development attempts

`evidence/CAPTURES.json` binds every raw file and the compressed lossless payload.
`evidence/verify.mjs` authenticates captures and Git source inputs without writes.

| Attempt | Result | Meaning |
| --- | --- | --- |
|01|82/82|First rendering/limit subset, not the final cohort.|
|02|94/95|Abort/EOF race skipped structural iterator return; fixed before2272. Two scoped TS errors were test override typing, also fixed.|
|03|112/113|Configuration-copy test reused exhausted stdin: fixture defect, corrected by fresh identical input, not changing expected status or product limits.|
|04|115/117|Two new anchor-boundary cases exposed stripped leading whitespace; renderer fixed, expected text preserved.|
|05|117/117|Corrected rendering/source and fixture.|
|06|117/117|Registered cleanup retains the primary producer failure; scoped types pass.|
|07|119/119|Adds actual injected-curl and finite downstream-head pipelines.|

These were successive author development attempts, not separately authenticated
historical product revisions or additive pass counts. The first compiled capture
also predates the source commit; final compiled inputs have explicit2272 binding.

## Pandoc comparison is not an equivalence score

Installed Pandoc3.10.1, SHA256
`61574e53a089110eae07817b91510ff150e826807ac020aa744e0ade23025e0d`, ran16
synthetic stdin cases with `--sandbox --from=html --to=commonmark-raw_html --wrap=none`.
Both implementations exit0 in all16: **5 exact byte/status/stderr matches,
11 differing outputs,0 execution errors**. The raw16 rows remain in evidence.

Differences include angle-wrapped destinations, ordered-list spacing, code fence/
span padding, entity escaping, script-adjacent paragraph separation, malformed
tail preservation and textarea text. The chosen Pandoc CommonMark writer produces
`[TABLE]` rather than this profile's pipe table. No table/HTML5/Pandoc superiority
is inferred. Different output is not automatically a defect or an equivalence
pass; no rendering expectation was tuned to make that comparison green.

## Independent review focus / limits

- Destination safety, nested/encoded active schemes and Markdown structure
  injection; safe HTTP(S)/relative links must remain useful. This is a converter,
  not a sanitizer or universal downstream-renderer security boundary.
- Literal preservation at malformed/token/chunk boundaries; documented unknown
  entity behavior versus actual loss of text. No complete HTML5 recovery, CSS,
  namespace or layout implementation is promised.
- Pre-growth limits, deep/raw/table/code adversaries, shared stdin, retained
  borrowed buffers, primary error/abort identity and output-write settlement.
- Host-supplied opaque producer/return promises are not hard-preempted. Cleanup
  expects cooperative return; do not claim arbitrary host-JavaScript termination
  or promote the separate TEMP owned-output design through this command.

```sh
node_modules/.bin/tsx --test --test-reporter=tap tests/commands/html-to-markdown/*.test.ts
node node_modules/typescript/bin/tsc -p tests/commands/html-to-markdown/tsconfig.json
node tests/commands/html-to-markdown/verify-compiled.mjs
node tests/commands/html-to-markdown/negative-controls.mjs
node_modules/.bin/tsx tests/commands/html-to-markdown/compare-pandoc.ts
node tests/commands/html-to-markdown/evidence/verify.mjs
```

The last three capture/replay tools are explicit opt-in, outside canonical test
discovery. Pandoc's exact local binary is required for its comparison, not for
canonical unit tests or the shipped library. Root wiring remains held for the
different review and root authorization.
