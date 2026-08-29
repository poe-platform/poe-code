# Bash surface audit — August 29, 2026

## Verdict and identity

**SOURCE/DATA ONLY; 0 product, Bash, compiler, build, install or engine runs.**
The exact user requirement is recorded in AGENTS by `a30231e0`. This report
does not establish that users cannot distinguish the virtual shell from Bash.
No version string, command label or diagnostic camouflage substitutes for behavior.

Selected public80 **author candidate, independent acceptance pending**:

- Derived source tree `c83f352f057c64917f219eb938f54aa42cdab829`.
- Source manifest `14a2a6a50d7748b677c4cc1261d6f69a411c1c21926c7acd884c86f2077e9450`.
- Full-package tarball `4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156`, 864000 bytes.
- This audit rehashes that tarball, not an installation or fresh 950-member extraction.
  Membership and public API execution remain inherited author evidence, not new proof.
- 23 selected Git source blobs are independently length/OID/SHA-bound in
  `data/ADMISSION.json`. They are not a whole-source behavioral audit. The selected
  view incorporates accepted public79/arrays, not moving HEAD or the pending Node module.

All line references below identify **these frozen blobs**, not necessarily current
checkout line numbers. `data/INSPECTIONS.json` binds actual source excerpts and
the contemporaneous evidence reads. Historical evidence reads have content hashes;
they are not newly replayed or automatically certified by a previous commit.

## High-visibility findings

| Finding | Frozen source | Classification and impact |
| --- | --- | --- |
| `set -u`, clustered `set -euo pipefail` | `src/shell/runtime.ts:3170` | Explicit supported-option list excludes nounset and clusters. Common strict-mode script header is outside this implementation. `-e` and `-o pipefail` exist; do not label all error handling absent. |
| `[[ ... ]]`, `function f { ...; }`, arithmetic `for ((...))` | `src/shell/parser.ts:665`, `:692` | Source grammar refusal/identifier restriction. Ordinary `f(){...;}`, `if`, `case` including fallthrough, `while`, `until`, word-list `for` exist. |
| `|&`, `&>`, background `&` | `src/shell/parser.ts:151`, `:573` | Lexer explicitly rejects `&`/`&>`; pipeline accepts `|`, not `|&`. This blocks familiar stderr-routing syntax. Background process/job semantics need separate design, not a synonym patch. |
| Dynamic `{fd}` allocation / persistent `exec` redirection | `src/shell/parser.ts:739`; `src/shell/runtime.ts:47` | Numeric FD grammar exists; dynamic allocation is not represented and `exec` is absent from the builtin list. Ordinary redirection support does not establish this Bash feature. |
| `declare`, `typeset`, `mapfile`, `readarray`, `trap` | `src/shell/runtime.ts:47`; inspected selected aggregate/core registrations | Absent builtin registrations. No new implementation inferred from ratified designs or synthetic observers. `local`, `readonly`, `export`, `read` are present. |
| `read -a`, `-u`, `-t` | `src/shell/runtime.ts:3315` | Option loop admits only `r/n/N/d`. Array ingestion and arbitrary-FD/timed read are not provided by existing `read`. |
| Array arithmetic/negative/associative subscripts | `src/shell/arrays/syntax.ts:34` | Index syntax is canonical nonnegative decimal, range <=2147483647. Sparse indexed arrays are present; this is not general Bash array arithmetic/associative support. |
| `PIPESTATUS` | `src/shell/runtime.ts:1434`, `:3477`; full selected-source search | Aggregate pipefail status exists; no producer of the Bash special per-command status array found. B30 must verify observation before any runtime bug claim. |
| `nullglob`, `failglob`, `extglob`, `globstar`, `lastpipe` | `src/shell/runtime.ts:3144` | `shopt` admits dotglob only. Dotglob acceptance must not imply all glob/shell options. |
| Word joining, IFS, empty fields and array `@` | `src/shell/runtime.ts:3685`, `:3725`, `:3751` | Implemented stateful branches, not demonstrated broken behavior. Mixed delimiter boundaries and empty-field filtering merit B01–B06; a temporary empty field can be filtered, so superficial source inspection is not proof of an extra argument. |
| Diagnostic prefixes/line numbers/status and NUL/UTF-8 | `src/shell/runtime.ts:2620`, `:3325`; `src/shell/input.ts:183` | Script-name/line-aware and generic diagnostics coexist; `read` rejects unsupported non-UTF-8 text boundaries. Raw pipe/output bytes must be measured separately from shell string decoding. No fresh mismatch measured. |

Source absence is scoped to this selected implementation/registration, not a claim
about every future plugin or live checkout. Explicit refusals remain observable
compatibility gaps even where intentional. None of these rows is a new executed
failure count. B01–B40 cover both positive existing behavior and likely gaps.

## What should remain truthful

For supported finite noninteractive scripts, target exact argument boundaries,
expansion order, scope/variable effects, descriptor order, bytes on each stream,
exit status and owned VFS effects. Compare command errors separately from host API
rejections, cancellation/limits and cleanup. Do not translate every host exception
into a Bash-looking status or suppress a required diagnostic to manufacture parity.

OS processes, job control, signals, PTY/readline, arbitrary host commands, device
files, process substitution, dynamic native builtins and unrestricted host Node are
not established by a provider-agnostic VFS API. Network remains opt-in curl; private
SafeJS and Node-provider work is not implicitly enabled. Bounded cooperative resource
control is not OS hard preemption. These limits require explicit documentation and
separate designs, not fake support or exclusion from an overall compatibility claim.

## Prior evidence, not a new combined score

- `benchmarks/reports/current-comparison-20260827/README.md:8` preserves old224 as
  168 command +36 kernel +12 composition +8 curl recipes; original/aligned scratch
  are different profiles of the same224, not448. Diagnostic/byte-representation
  caveats and non-additive breadth remain. Old missing commands do not prove current absence.
- Public79 bounded acceptance `bd772916c26dc87c54bafdaa784d18f058efa275` is a baseline;
  its four Worker-DENY regex rows remain an unqualified regression gap, not four
  newly established product bugs. Public80 author results are not independent acceptance.
- Arrays' sparse/indexed accepted scope does not close arithmetic-index, declaration,
  associative-array or mapfile gaps. Existing CD/STACK/LET/getopts/source/eval/dotglob
  must be retained and tested, not rediscovered as missing from old benchmark labels.
- Declaration ratification `7719f39e416a401588c83d355888f6b82202c109`,
  `tests/shell/declare-independent-20260828/ratification-v3/RATIFIED.md:1`, is a
  project profile, not GNU observations or implementation acceptance. P1–P4 cover
  finite option parsing, scalar/array/export/readonly behavior, query serialization
  and error ordering. Full GNU attributes such as integer/nameref are not promised.
- `tests/shell/mapfile-design-20260828/CURSOR-DECISION-v3.md:1` proposes an exclusive,
  nonreentrant record lease; borrowed completion must not close parent stdin.
  Concurrent admission and cancellation while an opaque next is pending still need
  approved bindings. Synthetic observer acceptance is not native43/product execution.

## Next priorities — judgment, not measured usage frequency

1. Authorize the small differential panel first; distinguish real defects in
   existing quote/IFS/redirection behavior from intentional missing syntax.
2. First narrow implementation proposal: `|&` and `&>` using existing ordered
   descriptor/pipeline machinery, with ordering, file/stderr obligations and closure
   holdouts. This does **not** authorize background jobs or runtime changes now.
3. Highest-impact broader semantics: nounset plus clustered `set` parsing, then
   `[[ ]]`. Require explicit unset/empty/array/positional exceptions and errexit
   context rules; do not implement only enough to print a successful strict header.
4. Implement the already ratified bounded `declare`/`typeset` profile only under a
   new source-owner GO. Follow with mapfile/readarray after the shared-cursor decision;
   registering a tool plugin cannot replace persistent shell variable semantics.
5. Add `PIPESTATUS`/remaining array syntax deliberately; retain exact profile gaps
   and diagnostic differences. No version/identity spoofing work is proposed.

## Reference and controlled next-run proposal

`REFERENCES.md` records official GNU source verification and local metadata only.
`CASES.json` declares **40 identities, all UNEXECUTED, no oracle outputs filled in**.
`ORACLE-PROPOSAL.md` requests a separately authorized finite observer/runner with
literal inputs and no external command dependencies. This packet is not that runner
and does not activate a previous native/full-gate/engine/XAN permission.

## Preparation and incident

Fresh capture root: `/tmp/bash-surface-source-v2-t3EFGu`. Startup capture preceded
source admission. Applicable instruction reads were separate direct context-only
tool reads; no instruction body is in this source/data publication. The earlier
`c3d79102` incident and deleted-copy/evidence-loss qualification remain in
`PREPARATION-INCIDENT.md`; it is not rescored or reconstructed.

`admit.mjs`, `read.mjs` are explicit source-data helpers, not tests or product
loaders. `seal.mjs` publishes existing metadata/captures and validates the finite
proposal as data only. No canonical `.test.*`, loose TypeScript consumer, compiler
configuration, production export or default registration was changed.
