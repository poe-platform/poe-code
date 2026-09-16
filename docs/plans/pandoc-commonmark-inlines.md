# CommonMark reader completion

Implement the original bounded TypeScript inline parser in packages/pandoc,
resolve first-wins definitions after block discovery, and bind only the verified
CommonMark reader. Preserve unrelated changes and existing thin safe-bash wiring.

1. Write failing original AST cases covering delimiter/bracket interactions,
   literals, targets, labels, entities, HTML, breaks and resource ceilings.
2. Implement delimiter and bracket stacks, shared label normalization, decoding
   and block-to-AST assembly without native or Markdown parser dependencies.
3. Exercise every normative 0.31.2 example in a separate licensed conformance
   lane; map upstream Markdown obligations to their applicable dialect.
4. Run maintained workspace test, lint and selected build checks, record evidence
   under docs/pandoc, and commit explicitly owned paths on main without pushing.

QA: inspect original expected ASTs and conformance mismatches, including block
coverage. Keep the normative corpus separate from original unit tests. Check
cancellation, bounded work/depth/retention, reference isolation, raw HTML nodes
and registry inspection through the thin adapter. No new CLI presentation.

Status: complete. Original unit tests (427), lint/source and test typechecks,
selected workspace build, all 652 normative CommonMark examples and inspection
screenshot QA passed. No unexplained failures remain. Applicability metadata
maps all 153 upstream Markdown-reader cases without importing their test
payloads or adopting their dialect-specific expectations. Evidence is in
docs/pandoc/commonmark-reader-evidence.md. One verified atomic reader improvement
includes its plan and evidence in a local Conventional Commit on main; no push
or release is authorized. The unrelated main Pandoc plan remains untouched.
