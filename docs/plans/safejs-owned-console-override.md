# Owned console replacement

Issue: #550

## Contract

- Add `builtinOverrides: { console: "extension-name" }` to realm and extension-run options. Only console is supported; the named registered extension must declare it.
- Default conflicts, caller console bindings, duplicate extension claims, other intrinsics and missing capability grants remain rejected before setup.
- Validate plain data options without invoking accessors or proxies. Copy authorization at construction so later caller mutations cannot broaden it.
- Replacement console must be a host object created in that realm. The extension can expose the same object through Window/self getters without copying it.
- Preserve lazy setup, normal work/data accounting, alias revocation, cancellation and exactly-once cleanup. No browser console implementation or dependency is added.
- One-shot runs must not silently ignore authorization when extensions are absent.

## Verification

1. Add failing public-core authorization and identity tests.
2. Implement narrow validation, conflict exception and owned-export checking.
3. Exercise adversarial options, collisions, independent realms, lazy/failed setup, abort, cleanup and one-shot parity.
4. Verify complete SafeJS suite, build and installed Node/Bun/TypeScript consumers.
5. Run normal hooks, push main, verify GitHub releases and registry provenance, then close #550 and resume monitoring.

## Local verification

- Four initial public API cases failed without the option. A separate null-authorization case also failed before strict validation was added.
- All 33 console cases and 64 combined console/realm cases pass.
- Complete SafeJS suite: 10,078 passed, 41 skipped. Skipped cases are not passes.
- Normal workspace/root build passes. Standalone installed tarballs pass complete public fixtures under Node and Bun, plus root/core TypeScript consumers and one-shot option parity.
- Normal commit/push gates and GitHub releases are still required. Check fresh registry consumers and provenance before closing the issue.
