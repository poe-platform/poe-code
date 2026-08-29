# PPR-002 Fresh Packed SDK Smoke Contract

## Scope and base

This bounded author repair on August 29, 2026 changes only the freshly generated
snapshot marker expectation in `scripts/smoke-test.ts` from `jobs-v6` to
`jobs-v7`. It adds no runtime change, version rollback, workflow edit, workflow
unit test, new QA runner, README change, or historical fixture rewrite.

The isolated clone is `poe-code-safejs-ppr2-smoke-contract`. A successful
`git -c pull.rebase=false pull --ff-only` precedes work. Its clean main base is
`b06e79ab841765f06d0a577230f10db28f98c457`. The exact smoke preimage SHA-256 is
`3ac8bd3f5777f81bb3cff6dc9f8e1b7e0e2f8e79128d9306dc64b3f5c732e3ca`.
Independent validation and root release repair remain required; this author
does not commit, push, publish, or claim a successful release.

The authorized publisher result, failed Release run `33255231803` log, and
finite marker diagnostic are copied with hashes into the evidence capsule.
Their reported failure is the SDK smoke assertion, not a runtime replay defect.
No original-audit payload or neighboring live author tree is read.

## Freshness and unchanged boundaries

`runSdkImportSmoke` generates its SDK script from literal strings. That script
calls `run(referenceSource, {bindings: referenceBindings})`, obtains
`referenceSnapshot` directly from `JSON.parse(await dump(referenceResult))`,
and replays it through `runCore`. It does not load a historical snapshot fixture.
The current emitter constant in `packages/safejs/src/snapshot/dump-format.ts`
is `jobs-v7`.

The entrypoint-identity check, both `[14,1,2e+100]` value assertions, one-host-read
assertion, all other SDK/CLI assertions, existing 30,000 ms timeouts, and cleanup
boundaries remain unchanged. Budget recovery, migration, checked agent errors,
MCP lifecycle, synthetic environment access, and public import checks remain
intact. Historical v6 fixtures and their markers remain byte-identical.

The existing smoke uses finite guest programs, an in-memory agent callback,
mocked MCP fetch, synthetic environment values, and stubbed guest file reads.
Its CLI commands are help, dry-run, or template-preview operations. No new
security probe, real LLM request, real guest network request, or guest filesystem
access is introduced.

## Genuine packed smoke and TDD

The local equivalent of the CI command is `env -u TERM npm run smoke`. It uses
the unchanged npm pack/prepack lifecycle and actual global and local tarball
installs. Only their filesystem context is isolated: `HOME`, XDG directories,
the npm global prefix, npm cache, npm user config, and temporary directories are
inside this owned clone. The isolated prefix leads `PATH`; cleanup cannot
uninstall the user's global CLI. Credential environment variables are cleared.
`SKIP_SYNC_SKILLS=1` disables dependency-install skill synchronization, not any
smoke, runtime, type, or hook gate. No live skill sync is run.

Pinned `npm ci` succeeds. The initial full build succeeds with 67 workspace
tasks and zero cache hits, followed by root generation, types, and bundling.
Local Node is `v22.22.2`; the captured Linux CI failure used `v22.23.2`.
This is a local reproduction, not a claim that the remote release was rerun.

The first local attempt fails during packing on a tsx IPC socket path under an
overlong temporary directory. Its complete output is retained and is not
counted as TDD RED. Shortening only the clone-local `TMPDIR` to `.tmp` allows
the unchanged smoke to run normally; no source or timeout is changed to do so.

Actual RED: all 19 existing CLI commands pass, then the packed SDK smoke fails
the original `jobs-v6` assertion with exit 1. The original tarball is captured
before the smoke's normal cleanup. Both installations and temporary projects
are cleaned by the unchanged smoke. The code change follows this reproduction.
GREEN results and exact public-artifact identity are recorded after execution.

## Formatting qualification

The untouched main preimage already fails
`./node_modules/.bin/prettier --check scripts/smoke-test.ts`.
Its actual warning and exit 1 are retained before any edit. The authorized code
change is one marker literal; no unrelated whole-file formatting or new ignore
entry is silently added. Any remaining baseline formatting warning is reported
explicitly rather than represented as a clean formatter pass.

## Evidence and handoff

Evidence and the immutable candidate are under
`out/safejs-remediation/ppr2-smoke-contract/`. The publication delta consists of
the smoke script and this repair report. The exact main preimage, postimages,
full RED/GREEN outputs, input failure logs, packed artifacts, gate commands,
and hash manifest support the independent validator's handoff.

## Confirmed GREEN and authorized formatting

The actual literal-only GREEN completes all 22 checks: the 19 CLI commands,
the full SDK smoke, and the credentials and config import smokes. The last two
import checks were not reached in RED because the unchanged SDK assertion
failed first. No command or assertion is removed to obtain GREEN.

RED and GREEN pack and install a byte-identical public tarball, SHA-256
`f6b3de012d70d5b32ff2f9137e00872de892802f23dc558c98093541236e0210`,
15,855,016 bytes. The runtime artifact is therefore unchanged; this is an
expectation repair in the external smoke harness, not a production rollback.
Captured tarballs and complete original command outputs remain available.

Root's follow-up authorizes necessary formatting within this owned script.
After preserving the literal-only preimage and the successful smoke evidence,
the existing Prettier failure is resolved with format-only `apply_patch` edits.
A canonical TypeScript AST comparison proves that formatting changes no node
structure or decoded string value. Compared with main, the sole AST difference
is the authorized fresh marker. All assertions, command order, timeouts, and
boundaries remain identical. No formatter ignore or workflow is changed.

The final formatted smoke postimage SHA-256 is
`59f263851f8745cc64fda503c634a4310203efcbd94d266188f2e492ec79cf32`.
The same genuine smoke command is rerun against this exact final script, with
its output and packed-artifact identity retained separately from the earlier
literal-only GREEN. The initial baseline formatting warning remains disclosed
in the preserved pre-edit logs; it is not silently discarded.

Fresh root types, direct strict smoke-script types, root ESLint, package lint
(all 17 rules), and 64 historical-v6/PPR2 controls pass. Final scoped types,
ESLint, Prettier for both publication files, and strict whitespace/diff checks
are repeated after the format-only refresh. No unrelated legacy type cleanup,
runtime edit, or extra source fix is included.

Curie's independent baseline manifest is verified at SHA-256
`774d6b1f6548cc1b35c620a5eaa321d1badc5ca68d895b1979c04e7a34674be2`
and retained as input metadata. It is independent RED evidence, not a substitute
for this author's actual RED/GREEN runs or the final independent validation.

The exact final formatted script passes all 22 smoke checks again with exit 0,
using the same `f6b3de...` tarball as RED and the literal-only GREEN. Its normal
cleanup succeeds. Final strict smoke types, ESLint, both publication formats,
64 historical controls, and whitespace/diff checks all pass. This resolves the
disclosed baseline formatting failure without broadening the semantic repair.
The two-file candidate is ready for Curie's independent validation; release
repair and publication remain exclusively with root and the publisher.
