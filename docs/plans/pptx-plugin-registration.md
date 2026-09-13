# PPTX plugin registration and bounded input

Status: Implemented and locally verified; local commit identity is recorded in Git.

## Scope and ownership

This increment hardens the existing explicit `pptx` plugin in
`packages/safe-bash/src/commands/pptx/index.ts`. The existing SDK engine remains
the execution authority. Root/public export mechanisms already expose the
plugin and SDK; no new default registration or export changes are required.
The delegated worker owns that adapter and the existing registered
`packages/safe-bash/tests/commands/pptx/selectors.test.ts` test file. Root owns
final lint, public artifact QA and the local commit. Do not push or release.
Root also owns the matching usage update in `docs/pptx/selectors.md`.

## Validated findings and changes

Original failing memfs tests established that the adapter attempted buffered
reads on streaming-only files (exit 3 instead of 0), read file content despite
explicitly unavailable capabilities (exit 0 instead of 3), and did not preflight
collisions before invoking registration. Resolve per-path VFS capabilities,
declare input requirements, admit bounded byte streams, and reject unavailable
file reads. Preserve stdin independently of file-read capabilities. Buffered
reads retain the requested bound and verify the returned byte length.

An additional failing test established that an unavailable stream needs a
buffered fallback before any content has been emitted. Never retry after partial
content or swallow cancellation. A direct command-context regression separately
reproduced synchronous stream-acquisition failure: the ordinary Shell wrapper
already converts that failure to an iteration failure, so its passing test alone
did not establish the direct-host behavior. Stream acquisition now occurs inside
the same guarded fallback boundary.

The single-command plugin preflights `host.commands.has("pptx")` unless explicit
replacement is requested. Shell registration remains asynchronous: setup failure
rejects the next execution, consistent with existing shell behavior.
Final review also reproduced missing runtime validation for replacement values
`"false"`, `1` and `null`. Both exported factories now reject defined nonboolean
values with a TypeError before registration, preventing truthy configuration
strings from authorizing replacement. Omitted/undefined retain the optional
default and actual booleans retain their documented meaning.

## Original acceptance evidence

The existing integration suite now has 36 cases. Added cases cover plugin
absence/presence, cross-shell reuse, duplicate registration, explicit replacement,
registration preflight, quoted Unicode VFS paths, byte pipelines and actual
`sh 'quoted script.sh'` execution. All file fixtures are original memfs content;
there are no host scripts, native shell fallbacks, downloaded unit inputs or
product network calls.

I/O cases cover streaming-only reads, unavailable reads, disabled streaming with
successful buffered reads, oversized providers, producer-reused stream buffers,
ENOTSUP during acquisition/empty iteration/partial iteration, caller cancellation
during streaming with iterator closure, and cancellation after capability
resolution before content access. Caller cancellation preserves the Shell's
exact rejected reason; this does not replace its root cancellation contract with
an ordinary mapped command exit. Existing SDK/CLI selection identity, one-based
selectors, schema, capabilities, bounded stdin and diagnostics remain covered.

## Research accounting and limits

Reviewed `docs/specs/pptx.md`, `docs/specs/office-cli.md`,
`docs/specs/office-sdk.md`, the test/API audit documents and inventory metadata.
The root reviewer independently confirmed all 3,673 test ledger pointers match
the exact inventory identity/file/line and all 2,407 API inventory identities
occur among 2,424 public obligations. Registration, shell, stdout, plugin and
cancellation are supplemental J06/J08 capability/byte contracts rather than
claims of new model parity. No upstream implementation or assets were copied,
and no inventory row is promoted to implemented by these shell tests.

The broader model, inherited members, collections, enums and BDD obligations
remain governed by their research registers. This narrow adapter improvement
does not complete the proposed utility. Corpus QA continues to use
`docs/pptx/corpus-manifest.json` only as a disposable-fixture authority; this
increment needs no downloaded fixture. No README or branding changes are made.

## Verification procedure and results

1. Run the original failing tests before adapter changes; retain the concrete
   wrong statuses and missing preflight evidence above.
2. Run `node --import tsx --test packages/safe-bash/tests/commands/pptx/selectors.test.ts`.
   Final result: 36 passed, zero failed/skipped, approximately 1.2 seconds.
3. Run the selected maintained build closure:
   `npm run build:workspaces -- --workspace=virtual-bash`.
   Passed: five declared dependency/workspace builds, including SDK and adapter.
4. Run `npm run typecheck --workspace=virtual-bash` after the build.
   Initial source check found that the test fixture's concrete class annotation
   omitted optional `capabilitiesFor`; corrected it to the public `FileSystem`
   contract. Maintained rerun passed source/tests, all 26 current consumer groups
   and required negative controls (expected exit 2). This is type evidence,
   separate from the runtime acceptance results above.
5. Root-reviewed maintained SDK tests: 482 passed across 15 files. SDK lint
   passed. Root's two focused discovery/export metadata assertions passed.
6. Root public QA passed built `poe-code/pptx` and
   `poe-code/safe-bash/commands/pptx` imports, command absence with status 127,
   explicit plugin install, and exact SDK/CLI stdout bytes, stderr bytes and
   status equality for help, schema and invalid-slide usage (with a read-input
   trap). Root rendered actual public Shell help, invalid-slide exit 2 and
   missing-file exit 3 with the maintained terminal PNG renderer to
   `/tmp/pptx-plugin-registration.png` and visually inspected readable output
   without clipping. The standard root screenshot route cannot install this
   optional plugin, as recorded in the existing selector QA.
   A final-built public check also passed the changed read behavior using an
   original tiny archive, literal expected slide ID 611, a `/vault` cwd and quoted
   `Harbor notes.pptx` path. Path-specific capabilities permitted streaming and
   rejected buffered reads, with a buffered-read assertion trap. The public
   plugin succeeded and its stdout bytes exactly matched the built SDK engine.
   Both final-built public factories also rejected `"false"`, `1` and `null`
   replacement values with TypeError before execution.
7. Final guarded repository ESLint passed: 11,848 configured inputs linted,
   zero errors/warnings, complete coverage with no gaps. The prior scan returned
   incomplete with zero findings while work was still in progress; it is not
   counted as a pass. Final focused package ESLint also passed, covering the
   replacement guard and its tests. Plan formatting and owned-file whitespace
   checks passed. Root stages only
   the adapter, its existing integration test, this plan and the root-owned
   `docs/pptx/selectors.md` usage update, then making a Conventional Commit on main.

Do not execute the whole pipeline, ship QA fixtures, modify unrelated work or
represent the local commit as a push or release.

The root attempted to select this file through `SAFE_BASH_TEST_RG` on the
workspace npm test route, then inspected the runner and found that variable is
not a file-selection option. The unintended full workspace test invocation was
stopped with SIGTERM after discovery; it is not a passing gate. The explicit
36-case Node invocation above is the focused integration evidence. The earlier
metadata test-name filter `pptx` selected no cases; only the subsequent two
explicitly named discovery/export assertions count as metadata evidence.
