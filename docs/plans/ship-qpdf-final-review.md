# ship-qpdf final diff review

Revalidated 2026-09-21 at checkout HEAD
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`, with unrelated working-tree edits
preserved. **Completion is blocked.** This review supplements
[the shipping verification](ship-qpdf-verification.md).

## Validated unresolved findings

1. No candidate exists: filesystem checks confirm the private qpdf command
   package, safe-bash composition facade, built JavaScript and declarations are
   absent. JSON-parsed safe-bash exports and dependencies contain no qpdf route.
   Actual ESM imports fail with `ERR_PACKAGE_PATH_NOT_EXPORTED` under default,
   `browser` and `workerd` Node conditions. These are checkout failure controls,
   not isolated packed-consumer passes or execution in browser/workerd engines.
2. The required parser and graph writer remain unavailable. The shared parser
   plan leaves byte syntax, revisions and parser API implementation open.
   `packages/pdf/src/index.ts` exposes rendering; its serializer imports
   `pdf-lib`, restricts identities to contiguous generation-zero objects,
   rejects Encrypt/ID and serializes only Root/Info trailer references. This
   cannot qualify the requested zero-external-dependency rewrite implementation.
3. The existing qpdf plan marks engine and command implementation done without
   corresponding code. Those contributor edits were preserved; their completion
   claims remain unsupported by the current tree.

There is no qpdf runtime diff to simplify or test for proxy-only functions,
duplication, unsafe host access or compatibility regressions. Failure handling,
cancellation, cleanup, accounting, ownership, CLI/SDK equivalence and version
compatibility are unverified and block completion. The acceptance document has
exactly 140 named-option rows, zero supported rows, and open product gates.
Pinned native research does not qualify an absent implementation.

## Disposition and next checks

The requested package-pattern file was moved by existing edits; its
[archived counterpart](archive/safe-bash-command-package-pattern.md) prohibits
empty scaffolds. No placeholder handler, guessed API, package README, export or
host fallback was introduced. Safe-bash usage does not advertise qpdf.

After a real parser/writer and private command are implemented through TDD,
execute the Markdown QA in the shipping verification: maintained package checks,
full repository routes for shared changes, isolated public-tarball runtime and
strict declaration consumers without private packages, and applicable condition
checks. Verify enforced flags, limits and outputs before documenting examples.
Inspect adhoc CLI/document screenshots when visible behavior changes. All these
acceptance cells remain open.

This increment changes documentation only. No code tests or screenshots are
applicable; no qpdf workspace unit/lint/build route exists. No tarball was packed,
package published, commit created, push verified or release observed. Local
commits: none. Remote-main delivery: none. Successful releases: none.
