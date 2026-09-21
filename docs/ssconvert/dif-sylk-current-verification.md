# Current DIF/SYLK verification receipt

This session audited the existing TypeScript ESM `ssconvert` DIF/SYLK providers,
shared SDK engine and explicit Safe Bash virtual command, preserving their existing
edits. Primary source remains under `out`. The Gnumeric 1.12.61 archive at
`out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` was authenticated with SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The captured dependency/plugin/C-locale/UTC profile is
[dif-sylk-reference-profile.json](dif-sylk-reference-profile.json). Its native
captures are historical evidence, not fresh qualification of this candidate.

Execute the current manual procedure at
[ssconvert-dif-sylk-current-qa.md](../plans/ssconvert-dif-sylk-current-qa.md).
The different agent's stress procedure is
[ssconvert-dif-sylk-current-stress.md](../plans/ssconvert-dif-sylk-current-stress.md).
The original full record audit and remaining format differences are retained in
[dif-sylk-verification.md](dif-sylk-verification.md); none of its historical
checks are represented as current executions here.

## Validated repairs

- SYLK `F;FD \t+0L` now accepts ASCII whitespace before the signed digit count,
  matching released `sscanf("%c%d%c")`. The original new regression failed
  before implementation. A negative control, `FD0 L`, continues to treat the
  literal space as the alignment rather than skipping it.
- DIF string-column overflow now consumes excess string records and can recover
  on the next BOT. Numeric overflow still terminates before its marker is read.
  The independent reviewer first reproduced two failures: a valid later row was
  lost, and missing EOD incorrectly returned success. Both are repaired. Overflow
  warnings are emitted on successful termination in released-source order.
- Six independent stress cases additionally cover unknown numeric-marker column
  consumption, ignored EOD trailers, reader/writer cancellation and byte budgets,
  SYLK semicolon escapes, error values and unknown directives.

Unit fixtures are original small in-memory records; existing engine/integration
filesystem fixtures use memfs. No unit native children, LLM queries or disk
fixture mutations were added. Product code has no native utility dependency or
fallback. Root retained Git/export/integration ownership; the reviewer changed
only DIF, its new stress file and its procedure.

## Current results

Node.js 22.22.2 on the supplied macOS workspace; live dirty candidate, no commit.

| Check | Current result |
| --- | --- |
| `npm run test --workspace=@poe-code/ssconvert` | PASS, 191 files / 4,665 tests; fresh Vitest execution, no task cache |
| `npm run lint --workspace=@poe-code/ssconvert` | PASS, ESLint, source TypeScript and test TypeScript |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | PASS, maintained selected dependency closure including ssconvert and Safe Bash |
| `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/ssconvert.test.ts packages/safe-bash/tests/commands/ssconvert-text.test.ts` | PASS, 58 tests; focused CLI/SDK byte, diagnostic/status, namespace and checkpoint/replay coverage |
| Manual built virtual CLI screenshot | PASS after harness correction; CSV-to-DIF/SYLK and both reopen conversions to explicitly selected CSV exited 0 and displayed identical `label,value` / `small,7` |
| Fresh native cross-format round trips | UNAVAILABLE: no Docker daemon socket and no local native ssconvert executable |
| Full `npm test`, root lint/build, complete Safe Bash gates | NOT RUN; current edits are confined to two codecs and their tests |
| Browser/workerd/other-runtime matrix, new cross-realm boundary qualification | UNVERIFIED; no boundary implementation changed |
| Timing/memory measurements | NOT RUN; deterministic tests are not performance claims |

All final checks followed the reviewer stopping edits. Earlier lint failed on two
transient new stress-test type errors (synchronous diagnostic and readonly signal
assignment); these were corrected and the final full package lint passed. Initial
manual screenshots exposed harness mistakes: omitted required limits produced
internal errors; omitted exporter for `fd://1` correctly returned exit 2. The
corrected final harness supplied both. Those early screenshots are failures of
manual invocation setup, not successful product validation.

## Remaining differences and unverified cases

Exact Gnumeric parity is not claimed. The existing audited mismatch in SYLK
format/font table enumeration for bordered styles remains; represented styles
round-trip in historical captures, but those captures do not certify this
candidate. Most-common-style ties remain unqualified. Automatic `ID;` content
selection over a misleading CSV suffix deliberately follows the user's
requirement; reference filename selection can differ. Explicit CSV selection
remains available. Bare `ID` is not automatically probed as SYLK.

Native GLib PID/timestamp wrappers and critical assertion diagnostics are not
reproduced. In particular the first invalid DIF coordinate can trigger native
assertion logs; exact complete stderr bytes are unverified. Native `atoi` overflow,
full row boundaries, malformed native-critical cases, all locale/codepage cells,
all formula/name/external-reference variants, most-common-style ties, native
`sscanf` iteration/format variants, arbitrary foreign metadata and fresh
cross-format interoperability remain unverified. Colors and released-plugin
ignored shared-value/table/comment fields are not counted as supported features.
No unsupported/unmeasured matrix cell is counted as a pass.

No README edits, staging, local commits, remote delivery, pushes, publishing or
release verification were performed. Temporary session-owned output is purged
only after this reduction; unrelated existing evidence is preserved.

## Candidate identity

Base HEAD: `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`.
This is a live dirty candidate, not a committed revision.

Scoped input digest: `97cd52cff99be8a1ee27617618d1d14cbc31316cf1f6ffed9cac2cac8b563971` (401 files).
Domain: every regular file recursively in ssconvert/src, ssconvert/scripts,
Safe Bash src/commands/ssconvert; root package.json/package-lock.json, both workspace
package.json files, ssconvert tsconfig.json/tsconfig.test.json, and the two executed
Safe Bash command test files. Sort relative POSIX paths; SHA-256 concatenate
each UTF-8 pathname, NUL and raw SHA-256 content digest. This scoped digest does
not authenticate all transitive workspace build inputs.

| Changed source/test | SHA-256 |
| --- | --- |
| dif.ts | `4b7e0b57deca5e4607cc19641ca09cb667962af477000ead835b3362f6c36e50` |
| sylk.ts | `670214cb071fa0f8a528e65d837c19867f33d36a18c523ee4b5d726ff12e1713` |
| dif-sylk-independent.test.ts | `c52d67f39c9d98d4039518e86ad385df342b355bf923ee4750935b3bf540a50f` |
| dif-sylk-stress.test.ts | `f12f6149b2edfd5b3ddb3fea4596c88263cbb708b0a593f841679316641c5db4` |

Inspected final screenshot SHA-256: `5c8fbce6f851ef335fda173d8eee6fab464479ea7fb1bbcb69444f53ff75fc72`.
SYLK reopen also displayed the source-compatible unknown-ID warning.
