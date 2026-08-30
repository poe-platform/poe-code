# Node design handoff — 2026-08-28

**Complete only as bounded design; NP1 is unimplemented and untested.** Scope is
this directory's four markdown/JSON artifacts. No product/runtime/registration,
dependencies, exports, AGENTS, other fixtures or private checkout changes.

- Read live parent/root authority and command priorities; no applicable descendant
  AGENTS existed on this directory's ancestry. This leaf's explicit write grant
  overrides no other owner's files. No children were delegated.
- Prior accepted evidence: f199787165ed3cfba82152cde31c5b794e03fad0, engine
  bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e, package SHA256
  6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e.
  Six prior SafeJS workflows are not six Node passes or live HEAD qualification.
- Public commit-pinned SafeJS README **is available**. Nine inspected public engine
  files hash-match frozen source evidence; index/README are additional public
  inspection, not newly executed closure. No namesake substituted. Node v22.15.0
  official docs are a comparison baseline, not a product/version claim.
- Proposed useful surface: real eval/primitive print/file/stdin execution,
  process argv/exported-env isolation, UTF8 output, stdin via fd0, JSON,
  restricted synchronous and promise VFS calls, POSIX path, builtin modules and
  invocation-cached local JSON. No npm/npx, local executable modules, general
  streams, binary buffers, native/host fallback, implicit network or host authority.
- **Architecture risks reported before seal:** frozen SafeJS has no public sync-VFS
  suspension facility; copied host values do not establish guest module/process
  identity; run budget resets and promise races do not establish invocation-wide
  retirement. A new provider contract is a blocker, not accepted capability.
- Exact root decisions D1–D6 are in DESIGN.md: subset naming, provider ownership,
  real sync versus separately approved async scope, VFS authority, optional/default
  registration, and future independent implementation/oracle authorization.
- CASES.json contains36 proposed identities, including refusal-after-earlier-effects,
  caller identity, held cleanup, output closure and caps. None was run or passed.
  Source evidence preceded drafting; this is a postinspection/preimplementation
  seal, not a preexisting-source freeze or new acceptance gate.
- Validation is limited to JSON syntax, unique case IDs, source metadata/hash
  binding and whitespace/diff review. No test, build, installation, native oracle,
  product/engine execution, private Git command or private file inspection occurred.
  Metadata utilities and public source-byte retrieval are not subject executions.

The Git commit containing this file is the atomic design seal; its identifier is
reported in the leaf completion message, avoiding a self-referential commit field.
Foreign untracked work and index state are not part of the seal.
