# yq author implementation protocol

Status: pre-source author controls, sealed August 28, 2026.

The candidate is `5137a74ec855a32d8a8860eb66b62eb44d11e290` plus the
accepted `src/commands/structured/interpreter.ts` bytes from
`74361026502d76b8c2b696f9c60e410ac9b78d95` plus new `src/commands/yq/**` and
`src/commands/structured/query-core.ts`. Expectations in `vectors.json` are
literal author controls. They are not copied from, a rescore of, or a substitute
for the 194-ID independent freeze at
`bd471ef682d768692a682d40009a874f51e3ad68` and its independent review at
`de89e478d8ddce62eac955708f1b87d7be1bd137`.

The runner must exercise the real command definition and private query adapter.
It must cover block and flow YAML, scalar styles, directives and documents,
Core resolution, explicit tags, decoded duplicate and merge-like keys, anchor
reuse/shadow/copy behavior, fatal UTF-8, numeric normalization, query reuse,
exact output and CLI information. Resource controls must observe carried owned
work, estimator charging, reserve-before-copy failure, no terminal flush,
post-await cancellation, publication guards, and natural close drain. No native
or reference implementation is used.

The source/build/package evidence is captured separately after implementation.
No author result is called independent conformance, full YAML support, native
parity, or a global release gate.
