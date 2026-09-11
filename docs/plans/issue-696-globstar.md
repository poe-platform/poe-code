# Issue 696: bounded recursive pathname expansion

## Validated problem

Current `shopt` supports only `dotglob`; `**` is treated as an ordinary wildcard
component. The memory-filesystem regression `shopt -s globstar; args **/*.txt`
therefore reports an unsupported option and misses zero-depth and deeper files.
Five focused tests failed before production edits (`/tmp/poe-696-red.log`).

## Implementation

- Add invocation-local `globstar` state and integrate it with the existing
  `shopt` parser, listing, mutation and cloned state.
- Keep the old walker when the option is disabled or no standalone unquoted
  recursive component exists.
- Use iterative directory traversal and deduplication, with bounded admission
  before retaining segments, candidates and path bytes. Preserve original
  pathname spelling and ordinary UTF-16 lexical sorting, with cooperative
  charged comparisons.
- Share fixed 100,000 entry and 100,000 state caps across the invocation. Count
  hidden/nonmatches separately from emitted expansion fields. Pass remaining
  `maxEntries` into host listings, verify returned lengths, and limit recursive
  depth to 128 in addition to existing filesystem/path and shell limits.
- Match symlinks as terminal entries with `lstat`; do not descend recursively
  through them. Preserve explicitly rooted symlink and ordinary suffix behavior.

## Oracle and verification

GNU Bash 5.2.37(1)-release, aarch64-apple-darwin25.4.0, is available at
`/tmp/safe-bash-scripting-oracles-20260904/bash-5.2.37/bash`. Independent native
fixtures qualify zero-depth, adjacent recursive components, explicit prefixes,
directory/dangling/cyclic symlinks and trailing slash behavior. They are isolated
outside the repository and are not production dependencies.

The first expanded maintained run passed 300 tests in 880 ms, covering the new
memory-only globstar tests and all existing dotglob author cases. Strict
NodeNext source/test checking passed. The expanded RED log also preserves two
test-fixture corrections: root `/dev` overlay listing merge intercepted synthetic
duplicate/oversized arrays, so those backing-provider admission tests now use an
owned `/work` directory. The product limits were not weakened.

Final focused results, public installed-package Node/Bun/browser/workerd checks,
normal build and guarded lint are recorded by the root coordinator after source
freeze. No completed release is inferred from local checks.

## Final focused validation

Independent review found an overescaped literal-prefix unescape expression;
quoted and backslash-escaped `a*` directory controls first failed in
`/tmp/poe-696-prefix-red.log`, then passed after using the established literal
unescape rule. Two further RED controls cover a file inside directory depth 128
and a provider honoring listing admission with `EFBIG`. Files no longer consume
an extra directory level; provider resource refusals retire the invocation with
the original error instead of allowing subsequent guest effects.

The maintained exact-file run passed **374/374** tests in 1.28 seconds:

```sh
node --import tsx --test --test-reporter=./scripts/test-reporting.mjs \
  tests/shell/globstar.test.ts \
  tests/shell/dotglob-author-20260828/dotglob.test.ts \
  tests/shell/pattern-admission.test.ts \
  tests/shell/pattern-boundaries.test.ts \
  tests/shell/brace-expansion.test.ts
```

Evidence is `/tmp/poe-696-final-green.log`. Strict NodeNext checking of the changed
tests and their source closure passed (`/tmp/poe-696-final-types.log`). The exact
integration input admission suite passed **100/100**
(`/tmp/poe-696-admission.log`). No native oracle, build, lint or publication gate
is counted by these focused results.

## Final integration validation

The normal `npm run build` passed, including all 71 declared workspaces (70 build
tasks) and root generation, TypeScript and bundle stages
(`/tmp/poe-696-build.log`). Installed candidate consumers passed 25 checks each
in Node, Bun, the browser bundle and actual workerd, plus three strict type
profiles. Evidence and the visually inspected CLI screenshot are in
`/private/tmp/poe-696-public-nn6esa5s`.

Final `npm run lint` passed in 312.48 seconds: all 10,513 configured files were
linted with zero errors or warnings and 25 receipts; TypeScript and workflow
checks also passed (`/tmp/poe-696-lint.log`). Independent review approved the
frozen implementation. These are local qualification results, not publication.
