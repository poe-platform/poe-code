# command-csvstat task review

Reviewed the working tree on 2026-09-20 at HEAD
`35d01c57f8078d8afa916dc59929395d857e9c55`. Completion is blocked.

## Validated blocking finding

There is no `packages/safe-bash-command-csvstat` implementation, no admitted
csvsort inference engine, and no shared CSV parser/selector/Decimal/inference
workspace to consume. Package source and manifest inventories confirm their
absence. `packages/safe-bash/package.json` has no csvstat export or dependency.
The existing [wiring prerequisite review](safe-bash-csvstat-wiring-prerequisites.md)
and [engine prerequisite review](safe-bash-csvstat-engine-prerequisites.md)
therefore remain unresolved.

The `engine-csvstat` prompt requires shared parser, selector and inference
contracts and prohibits duplicating shared engines. Its recorded done status
does not provide those implementations. The independently specified
[acceptance controls](safe-bash-csvstat-acceptance.md) require exact Decimal and
microsecond temporal values; substituting JavaScript Number or Date would
violate those controls. XAN CSV/selector sources remain explicitly held in
`packages/safe-bash/integration-boundaries.json`; they were not inspected or
imported during this review.

The requested package-pattern path is deleted in the existing working tree.
Its archived copy was read without restoring or changing either path. The
maintained private-command build/export path is available, including
`resolvePrivateCommandBuild` in `scripts/bundle-safe-bash.mjs`; absent command
and engine APIs prevent meaningful integration or installed-consumer testing.

## Review disposition

No csvstat code diff exists to simplify or exercise. Proxy-only functions,
duplicated statistics logic, host access, cancellation, budgets, byte ownership,
cleanup and snapshot/version behavior cannot be runtime-qualified for an absent
implementation. No placeholder handler, unsupported-feature facade, export or
default registration change was introduced.

Complete and admit the shared engines and exact statistics APIs first, then
write failing memory-VFS CLI/SDK controls before implementing command wiring.
The acceptance document already specifies independent native-semantic controls
and the required grammar/error/chunk/cancellation/resource cells. Focused
maintained lint/unit/build checks and isolated packed runtime/declaration
consumers must follow actual implementation; none were claimed in this review.

Only this review record was added. Unrelated files and plan statuses were
preserved. No commit, push, release or package publication was performed.
