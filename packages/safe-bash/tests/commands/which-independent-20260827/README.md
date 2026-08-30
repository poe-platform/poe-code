# Independent WHICH sidecar preparation — not yet frozen

Prepared August 27, 2026. Root's exact profile and Faraday's stable module API
have not yet been routed to this reviewer. **No normative which fixture freeze,
module execution, native comparison, candidate acceptance or public integration
is claimed.** Stage2 invocation-cancellation review remains the primary task.

`draft-cases.json` contains **28 proposed families**: 18 behavior, four logical
limit, two cancellation/cleanup and four type families. Each records concrete
inputs and separates root-intended invariants from unresolved expectations. No
FreeBSD output/status has been guessed to make an executable test green.
There is no hypothetical factory import or fabricated registry pathname.

## Existing discovery inspection

`observe-type-path.mjs` executed twelve small virtual `type -P` / `type -aP`
observations on authenticated source `44f00bf84278e3361b52106478d59c707ab7b2bc`.
All tracked TypeScript product bytes matched that revision before and after.
This was a **live-checkout inspection**, not an isolated candidate replay.
Inputs were MemoryFileSystem data and a read-only wrapper; the tracing facade
permitted stat/access and rejected content reads or mutations. No native which,
native executable, host PATH fallback, subprocess launched by product code, or
external server was exercised. Source hashes, exact scripts, virtual env, output,
status and metadata calls are retained in `type-path-observations.json`.

Observed behavior is **not the future which oracle**:

| Observation | Existing virtual discovery behavior |
| --- | --- |
| First/all | First stops at `/a/tool`; all follows PATH order. |
| Duplicates | `/a:/a:/b` prints `/a/tool` twice, then `/b/tool`. |
| PATH empty | Probes virtual cwd and prints `./tool`. |
| PATH absent | Probes virtual cwd and prints `tool`; it does not consult host PATH. |
| Empty components | Leading, repeated and trailing empty components each produce a cwd candidate. |
| Relative / explicit paths | Metadata uses resolved virtual paths; output retains `bin/tool`, `./tool`, `/a/../b/tool`. |
| Eligibility | Uses stat-followed target type plus X_OK; skips a directory/non-executable candidate and continues. Symlink output is the link pathname. |
| Builtin / registry | Forced path lookup emits no invented path for `true` or `registered-only`. |
| Read-only wrapper | `access('/a/tool', X_OK)` succeeds, but `type -aP tool` exits 1 with no output because wrapper capabilities.permissions is false. The lookup never calls access after stat. |
| Permissions absent | The same early capability gate suppresses matches even with a working access method. |

The last two observations follow `Runtime.searchPaths`' explicit
`capabilities.permissions !== true` guard. ReadOnlyFileSystem advertises false
while forwarding X_OK; it only rejects access requesting W_OK. Therefore blindly
reusing that guard would import a capability-policy decision into which. This
review does **not** label it a newly proved product bug or authorize filesystem,
shell or contract changes. Root must choose the intended executable-authority
profile before B11/B17 become normative.

At the end of inspection, `src/commands/which/` contained only untracked
`DESIGN.md` and design-evidence files (manual/source/provenance data), no observed
TypeScript implementation. Only those filenames were inspected; the uncommitted
author profile was not treated as stable policy or an implementation candidate.

## Policy needed before the actual freeze

1. **Lookup result:** first/all/silent combinations, mixed-program aggregate
   status, miss diagnostics, no operands, unsupported flags and exact `--`/`-`
   treatment. Define silent diagnostics separately from suppressed match output.
2. **Namespace and display:** unset versus empty PATH, empty components,
   duplicates/repeated operands, slash operands, trailing slash, normalization and
   relative labels. No host fallback or registry-only executable paths is fixed.
3. **Permission/error authority:** stat mode versus X_OK, meaning of permissions
   false/absent, symlinks, ELOOP, denied versus provider-failure errno classes,
   and whether an error terminates search or merely eliminates one candidate.
4. **Logical caps:** exact inclusive byte accounting for proposed 1 MiB argv/PATH,
   100,000 probes, 16 KiB constructed path and 1 MiB output. Are argv/PATH combined?
   Is a probe a candidate or every metadata call? What bounds many empty args?
   Is stderr included? Are limits configurable for bounded boundary tests, and
   what is zero/invalid-config policy? Define partial output on late limit failure.
5. **Lifecycle:** cooperative metadata cancellation, no opaque preemption claim,
   awaited writes, sink/error mapping at direct module versus Shell boundary,
   and any owned-output enrollment. Do not conflate unread stdin owned by Shell
   with input acquired/read by which.
6. **Actual module API:** factory/plugin/type names, option fields, replacement
   behavior and owned source paths. Public root/subpath wiring remains separately
   authorized; missing exports must not be mislabeled a module defect.

Faraday owns primary manual/source research. This sidecar does not duplicate it
or claim FreeBSD 14.3 is provisioned. No Darwin native oracle was exercised either.
Any later Darwin comparison must name its actual platform/binary/profile and stay
separate from a FreeBSD claim. No dispatch benchmark or provider breadth was added.

## Next bounded action after root routes policy

Bind the unresolved fields, author the 20–30-family executable module/type cohort,
freeze exact bytes **before** production inspection if timing permits, and record
actual exposure/timing without retroactive pre-code claims. Candidate replay will
use authenticated isolated inputs, direct module tests plus actual Shell flows,
and targeted mutations for fake registry matches, mode checks, swallowed errors,
UTF-8 accounting, resource leaks, output backpressure and ignored cancellation.
This draft is not permission to implement production or revise Stage2's seal.

Validate the draft's inventory and inspection bindings without rerunning it:

```sh
node tests/commands/which-independent-20260827/verify-draft.mjs
```
