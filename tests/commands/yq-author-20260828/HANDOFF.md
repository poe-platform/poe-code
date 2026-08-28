# YQ module author handoff

## Candidate binding

- Source candidate: `35da18547ca82a67be9ca22b4adc21e3b8060780`, including initial module `dd950b66`, cleanup correction `6b3b5c44`, and restricted-production correction `35da1854`.
- Fixed baseline: `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
- Accepted length revision: `74361026502d76b8c2b696f9c60e410ac9b78d95`.
- Accepted interpreter blob: `d3ba11f0057b07d5ad307c5dfbb5f0612a87a047`, SHA-256 `e32ad45efe69544ed95b43b97f191006f10d3beea9ca9e2a3327843dffd45a74`.
- Final contract freeze: `bd471ef682d768692a682d40009a874f51e3ad68`; verification: `de89e478d8ddce62eac955708f1b87d7be1bd137`.
- Authored fixture revision: `1d802e7af02add9e334ab934668d41d6e5ffbbe2`; fixed reconstruction driver: `54e6d094ec9ef6e9f58988b82057a0ed67bec64b`.
- Immutable evidence commit: `ef6032b210feb5cf19e6f6f94c40413740bef335`.

The candidate consists of the fixed baseline, the exact accepted interpreter,
and only the seven new authorized source paths listed in
`evidence-v4/SOURCE-MANIFEST.json`. It does not use mutable HEAD implementations
of LET, CD, timeout, or XAN. No AGENTS file is present in a manifest, source
archive, or package.

## Final artifacts and execution

`evidence-v4` is the final author capture. Its selected manifest has 279 regular
files; 273 non-test files form the complete source archive. The archive is
2,713,600 bytes with SHA-256
`e4e6880a3622952b153a8261fec007908e1495584abf705ba2b150e95badcedc`.
The complete 870-entry package, including README and package metadata, is
782,141 bytes with SHA-256
`2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d`.
Both artifacts reproduced byte-for-byte in a second clean out-of-tree run.

The built `dist/commands/yq/index.js` is 22,115 bytes with SHA-256
`c2527c7472fb7889a0583f49c5e0f2556471936489b8becd60b5682a07b86630`.
The package has zero runtime dependencies. Its bound module passed actual Shell
plugin execution after offline installation and after a physical package move.
Its declarations passed strict consumers in both locations. The wrong baseline
source and wrong installed-module hash controls failed as required. Root export
and default-registration absence were also checked.

The final layout ran 15 build/archive/package/consumer controls. The authored
runtime file passed 26/26 tests; the separately selected parent jq join-safety
file passed 19/19. These are two distinct test layouts, not 45 independent YAML
cases. Build and scoped strict types passed. All driver-created sessions,
iterators, outputs, shells, workers, and temporary directories drained or closed
naturally.

## Preserved iterations

`evidence-v1` and `evidence-v2` retain the original non-reproducible archive
timestamps and earlier driver coverage. `evidence-v3` is the first normalized,
reproducible archive for source `6b3b5c44`. `evidence-v4` supersedes it for the
candidate binding above. None was overwritten. `FIRST-FAILURE.txt` preserves the
first B04 failure; the fixture remained fixed and the parser was corrected.

## Settled limits and review status

This is the frozen restricted YAML 1.2.2 Core profile over the existing query
engine, not full YAML, Mike Farah yq compatibility, jq parity, or a full
conformance claim. Whole current documents and preflighted output documents are
retained within logical caps. Provider `readFile` allocation and bounded query
compiler/interpreter work retain their documented opaque or synchronous
qualifications; sink effects completed before a later failure cannot be rolled
back. The module intentionally has no root/package export or default aggregate
registration.

Live `npm run typecheck:all` remains blocked before its build by unrelated
unclassified timeout, XAN, and WebDAV `.mts` inputs outside author ownership.
The fixed reconstruction's build, scoped source/test types, installed types, and
moved types all pass. Independent Sagan review is still required; this author
capture is not self-acceptance.
