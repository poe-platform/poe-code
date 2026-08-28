# Additive npm tool closure — 2026-08-28

Root approves this exception **only for npm10.9.7 tool metadata**, not selected
source, package or harness. `fd422e68` and its initial no-linked-member refusal
remain unchanged. No array product observation happened in that attempt.

The separate inventory contains 2,027 regular files, 517 directories and exactly
12 links; root and entry modes, regular lengths/SHA256 and exact link text are
bound. Encoded inventory SHA256:
`5623653d01886efdbb55e5a4c6b387ba8af00e4b4673740caf23a482ce473af4`;
decoded SHA256:
`1a09d4358a33e162bcc6fc260258d70089a0acdc463d0b0dac56f3f232dcf4ce`.
The previous twelve link target hashes/modes are independently compared. No npm
or product code was executed to create this inventory. No tool links are copied.

`npm-tool.mjs` scans physical regular payloads without following links, then
matches the entire exact inventory before resolving any aliases. Link resolution
uses only bound components, rejects external targets (including outside-then-back),
cycles, non-file targets, missing components and unexpected aliases. Physical
realpaths must equal the contained bound targets. Census includes additions and
mode changes. This is drift detection around a trusted local tool run, not atomic
protection against a concurrent hostile host mutating files between checks.

Before continuation run the 24 frozen DATA/SYNTHETIC/read-only controls in
`npm-tool-controls.mjs`; any failure stops admission. Controls cover exact
cross-realm own data, holes/accessors/extras, target/text/mode drift, added/missing
entries and realpath containment. The unchanged regular-only boundary must still
reject npm's links. These are tool-admission controls, not array passes.

Then execute `node candidate-v1/admission.mjs` from this owned scope (actual
Node22.22.2 SHA already pinned). Same immutable 269 inputs and root-selected full
862 package as `ADMISSION-PRESEAL.md`; one build, one offline ignore-scripts npm
pack and nine strict type/AST children with unchanged limits/expectations. npm
tree and actual Node bytes are checked before/after build/pack and at terminal
admission. Direct absolute npm-cli is used, not `.bin` dispatch or a PATH alias.
Root-selected tar must match exactly; source/package/harness guards unchanged.

The additive source and this recipe are committed before execution. Capture the
control coordinator and admission coordinator status/output in new exclusive
evidence. Ordinary type assertions aggregate after child reap; integrity/cleanup
failure stops dependents. No retry or fixture correction is authorized by this
recipe. Runtime adapters/layout/mutant execution remain subsequent presealed
phases of the already-authorized array review, not implied by build/type success.
