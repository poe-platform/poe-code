# Fix #608: source-consumer resolution ownership

## Validated failure

After a fresh full build, all 25 installed consumer groups and all three exact
negative-diagnostic groups passed. The three maintained source-consumer groups
compiled successfully but failed the post-compilation guard: `virtual-bash`
resolved to the authenticated candidate `dist/index.d.ts`, which the guard
misclassified as an unadmitted peer declaration.

The checkout-root `poe-code` peer physically contains the candidate package,
source fixtures and ambient dependencies. Ancestor containment alone therefore
does not establish peer ownership. It also incorrectly identifies source
fixtures as peer declaration importers for private mappings.

## Scope and invariants

- Identify peer importers by authenticated declaration-closure membership.
- In the overlapping checkout profile, distinguish candidate paths and nested
  `node_modules` dependency paths from otherwise unadmitted peer paths.
- Explicit peer public imports, admitted private specifiers, and relative/private
  imports from authenticated peer declarations still require peer closure,
  target, export/mapping and byte authentication, even into competing paths.
- Authenticated peer closure targets always retain their byte checks.
- Preserve candidate dist/export/hash checks and peer metadata authentication.
  Unknown peer declarations and source fallbacks outside competing namespaces
  remain rejected. Do not broaden isolated installed-peer admission.
- Preserve the maintained source-fixture qualification: these are strict source
  consumer checks, not isolated packed runtime or provider acceptance.
- No public API, diagnostic expectation, runtime, README or package task change.

## TDD and checks

The new memfs-only test file is
`packages/safe-bash/tests/integration/typecheck-consumer-resolution.test.ts`.
It exercises the existing exported resolution guard without production test
hooks or filesystem fixtures. Its first 18-case run had 13 passes and five
failures before implementation; the same 18 then passed after the ownership
fix. Additional controls cover ambient-target peer rejection, authenticated
closure bytes in dependency namespaces and metadata changes.

The test is registered by exact literal path in the maintained integration
discovery assertion. Run the focused test and discovery assertion first, then
the maintained `typecheck:consumers` route against freshly built declarations.
The root owner coordinates full build, guarded lint and separate commits.

## Final verification

All 24 focused memfs controls pass, including independent review. The maintained
consumer route passes after the fix: three source groups, 25 packed groups and
all three unchanged exact negative-diagnostic checks. It passes again after
integrating remote 5fd0a94cd and rebuilding the public package, with the #588
candidate still local. This is type qualification, not runtime/provider
acceptance. The combined focused budget/guard/plugin cohort passes 78 tests.
Guarded lint passed on 9,649 files with no errors/warnings and 25 receipts before
that incoming WebDAV-only integration; this guard's source is unchanged since
the lint check. Remote delivery and publication are tracked separately.
