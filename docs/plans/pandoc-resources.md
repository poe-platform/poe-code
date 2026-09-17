# Resource resolution

Implement original TypeScript resource resolution and extraction through injected
VFS capabilities. Preserve joined-input origin sidecars, keep URI decoding separate
from resource keys and output paths, and reject unsupported acquisition before reads.

1. Add failing original memfs cases for identity, search paths, denial, limits,
   cancellation, collisions and extraction preflight.
2. Implement package-owned policy and thin command VFS wiring, without native tools.
3. Run package tests, build and lint; record evidence in docs/pandoc and commit
   explicitly owned files on main. Do not push.

QA: inspect rewritten image URLs and exact extracted bytes in the original cases;
verify denied inputs cause no resource reads and preflight failures cause no writes.
Document nontransactional partial writes and unsupported data URIs.

Implementation complete: package-owned VFS resolution, explicit CLI/SDK options,
literal embedded keys, weak origin sidecars through joined parsing and SDK read/write,
bounded streaming/bounded VFS reads, collision naming and exclusive extraction.
Original failing cases reproduced missing options, base inheritance, acquisition
before denial, unsafe embedded names and untyped command-provider injection.

Final verification: package test/lint/typecheck and selected maintained workspace
build; manually capture and inspect command output using the repository screenshot
renderer with the built converter and an in-memory VFS. Evidence belongs in
docs/pandoc/resources-evidence.md. This is one atomic resource-resolution change;
the existing unrelated orchestration plan edits are excluded from its commit.

Verified: 628 package tests pass, package lint/source/test typechecks pass, and
the maintained selected workspace build passes. CLI transcript screenshot inspected.
This milestone is ready for its local Conventional Commit; no remote delivery or
release was requested. Nontransactional writes and unsupported data URIs are
documented in the evidence.
