# Independent canonical-profile acceptance — August 27, 2026

**Accepted for the declared test-profile migration only.** One independently
executed whole four-file canonical suite passes **183/183**; the separately
executed strict historical discovery suite remains **36/52,16 failures, exit1**.
No product fix, full-native parity, overall-green gate or superiority is claimed.

## Exact accepted inputs

Product source is the full committed archive
`6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a`, not the contemporary live aggregate.
Candidate test-only commits, read after ROOT's relay:

- A: `da81b8f73a6cf98fe8b44b2deee00ed80f1599d4` — discovery profiles.
- B: `4fa20ac6cadb9d37fa9da4d205dc37a5a1bcb9f9` — differential/gap references.
- C: `7e0a578e277d123ba0fa86e48b46f4fd0431b839` — safeplugin classifications.

Runtime SHA256:
`5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb`.
Parser SHA256:
`10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e`.

All27 reviewer files from `a48b1e9` plus `1dc0aed` and all11 author preparation
files at `ab02ed8` remain immutable. Both endpoint audits check67 distinct paths
against Git blobs/current bytes. All19 original helper/fixture/oracle paths
(23 original paths less four authorized tests) are identical to source6e.
The three commits change only the four authorized tests and author-owned new
test-profile evidence/helpers; no source, contracts, FS, manifests, exports or
dependency edits are accepted or performed here.

## Policy delta and denominator

The routed inventory is **27 total =25 historical-profile +2 classification**,
not29, and not27 newly fixed product bugs. All original logical inputs remain.

| Current canonical file/cohort | Native/policy rows | Other controls | Measured total |
| --- | ---: | ---: | ---: |
| Discovery | 52 GNU5.3 | 8 hosts | 60/60 |
| Differential | 72 exact differential | 5 syntax +1 provenance | 78/78 |
| Current-gaps | 11 exact differential | 0 | 11/11 |
| Closure | 24 primary +2 safeplugin | 8 hosts | 34/34 |
| **Canonical** | | | **183/183** |

The historical52 are separate and runnable, with all original names and full
strict assertions intact: **36pass/16fail**, no skip/xfail/todo, status1.
Canonical and historical executed once each; no pooling of positive controls,
author runs or historical successes into183. The prior combined235 becomes
canonical183 plus separately named historical52, not235 newly green tests.

Group A preserves the entire discovery assertion body identically in canonical
and historical paths. Its16 historical losses remain exact named failures;
canonical selects the entire pinned GNU profile, not a per-case oracle.
All eight host controls are unchanged. Group B changes reference selection and
labels, not direct `Shell.exec`, scripts, stdin/env/fixtures, assertions or status.
Group C changes only two explicit whole policy tuples and their safeplugin
labels. Existing native lookup bytes remain immutable, including builtin losses.

## Independent native and registry checks

No fresh native capture ran in acceptance. The pre-candidate `1dc0aed` capture
supplies176 actual observations (88 each GNU5.3 and Apple3.2) plus two existing
name/line controls. The earlier338 and role-corrected338 native artifacts remain
separate unchanged history. Candidate reference tuples were compared to all176
aligned observations, not inferred from author-green results: exact original
source, stdin, argv, scrubbed C/UTC environment, status, stdout/stderr bytes,
initial/final relative files, entry types and permission modes agree **176/176**.
The author stores stat mode with file-type bits; independent mode stores permission
bits and type separately. This representation is explicitly decoded, never used
to erase a native/VFS mode mismatch.

All88 canonical reference inputs use the same actual native protocol:

```text
--noprofile --norc -c ORIGINAL_SOURCE shell
GNU5.3 SHA256 8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c
Apple3.2 SHA256 35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3
```

This root-declared profile aligns native invocation name with the existing direct
product API. There is no virtual `bash -c` wrapper, source/status manipulation,
diagnostic replacement, dropped stderr assertion or per-row dialect selection.
The two earlier wrapped-entry127→1 results remain untouched follow-up, not fixes.
The native profiles are Darwin captures, not GNU/Linux environment-order claims.

The two candidate safeplugin tuples exactly equal the independently frozen
`a48b1e9` policy values, including exit0 and empty stderr. The real standard
registry registers printf; virtual output truthfully says `command`/`registered
command`, whereas native printf is builtin. Earlier independent real-registry
observations and native raw losses remain preserved. Candidate lookup uses the
unchanged real registry/probe, and actual label-spoof/stderr mutations fail.
No blanket output replacement or fake builtin classification is introduced.

Original differential/gap assertions include stdout/stderr (text and bytes),
status and file bytes/types, not modes. All40 supplementary mode-loss rows remain
raw limitations (34 differential,6 gaps): aligned saved-product GNU comparison
is88/88 original fields but only48/88 full modes-inclusive tuples. Historical
strict comparison is74/88 excluding modes,37/88 including modes; original broad
syntax assertions yield79/88. These aligned preparation counts are reused facts,
not new product executions, FS waivers or current full-kernel counts.

## Isolation and execution provenance

The isolated project contains all173 source files plus four unchanged root
manifests from6e, each verified against its Git blob. Twenty-eight exact candidate
test/helper/native inputs plus two independent tracing/compiler drivers are
copied; no live `src` overlay or narrowed public API is used. Only the existing
dev `node_modules` directory is symlinked, no install. Its318 file/link identities
remain unchanged. The archive's208 file/link identities are before/after checked;
all source files remain Git-identical even during laboratory test mutations.

The independent preload hashes actual module URLs before/after loading, rejects
any path/hash absent from the archive/toolchain policy, and propagates trace-only
environment through Node children whose original helpers scrub their environment.
It does not alter virtual source, args, environment or output. Canonical execution
records17,188 actual module loads (13,674 product), including88 natural broad
`src/index.ts` loads. Historical execution records50 loads. Across canonical,
historical, typing and14 lab runs:18,884 actual loads, no source/import/input
mismatch. Module hashes bind stored TS/JS and pinned transpiler inputs; this is
not a claim to hash transformed machine code or prevent transient write/revert.

Raw TAP/stdout/stderr/status and before/load/after manifests are durable in
`acceptance-execution.json`; the provisional canonical checkpoint is retained,
not substituted for full guards. Parent processes have hard deadlines, output
caps and detached-group cleanup. All owned groups are absent and the isolated
archive is removed only after raw proof is saved. No foreign process is signaled.
The retained Git sources, copied-input hashes and driver reconstruct the archive.

## Candidate mutation controls

Two unchanged laboratory positives pass; **12/12 actual candidate mutants fail
with assertions**, not parser/import/deadline errors. Each uses an explicit test
name filter and is a laboratory subset, never a whole-cohort denominator, even
when Node reports one test and zero skips. Four provenance failures occur during
module setup rather than execution of the selected case. All original assertion
code remains in place except the disclosed observation/expected-input injection.
Only isolated test/helper files are changed and restored; no product source is
mutated. Exact original/mutated text and hashes are retained per mutant.

- Wrong status with unchanged output; exact stdout byte corruption.
- Missing diagnostic bytes with same status; corrupted relative file bytes.
- Current-gap diagnostic byte corruption; discovery expected diagnostic byte.
- Fixture-file identity change; profile identity; uniform invocation-name identity.
- Mass native-golden rewrite, rejected by the candidate's frozen checksum chain.
- Native-builtin label spoof and safeplugin stderr byte corruption.

These exercise the candidate paths, unlike the earlier12 independent-checker
mutants. No new mode assertion is promised. Checksum controls do not claim
security against an adversary changing every trusted pin; the separate immutable
input/independent-native audit binds the reviewed candidate to its actual history.

## Compiler checks and historical attempts

Scoped TypeScript checks exactly four test roots plus three new TS modules:
**exit0, zero diagnostics,331 actual reads**, before/read/after guarded against
archive/toolchain identities. One additional requested **LIVE global noEmit**
also exits0 with zero diagnostics:2,697 roots,2,885 actual reads. Its HEAD stays
`1521bda5500db1fbe8af374d615fff5d4039abd8`, input/read endpoint guards pass, and
all read text hashes equal source bytes. The live compiler runs
2026-08-27T07:09:53.712Z–07:10:01.802Z. It uses the existing live environment,
does not build, and reads no dist file in this run. This is a qualified live
typing snapshot, not the archived source aggregate or global test acceptance.
No foreign diagnostic fix or retry was performed.

Author attempts remain explicit separate history: A tracing-loader failed before
tests, then60/60 and strict historical36/52; B recorder E2BIG lost counts, with no
B-alone retry or inferred denominator; C34/34 and author final183 are distinct
runs. Author14,040 loads/88 index loads and scoped331 reads are not this verifier's
execution. Independently, the initial audit used the wrong spelling for the
historical metadata profile; correcting it to actual frozen `Bash3.2-historical`
occurred before any test/product run. No native tuple or expectation changed.
The earlier aligned-native Git-buffer preflight correction remains documented
in `ALIGNED_PREPARATION.md` and was not repeated here.

## Limits and durable checks

No OLD9, five custom-first-read1200ms requirements, kernel/original36+72,
accepted errexit/accounting, public consumer or fullgate was rerun. Custom5 stays
OPEN. Preserve old30/36,52/57 and diagnostic history without relabeling them
current results. Wrapper error-status follow-up, modes, native-profile losses
and other source scope remain separate. This migration improves test-profile
truthfulness; it is not27 source fixes or proof of full Bash parity.

`acceptance-integrity.test.mjs` validates only these durable records and identities,
not another product/native run. `acceptance-input-audit.json` retains the entire
four-file source diff and original27 routed tuples; endpoint proof is additive.
`acceptance-live-global.json` retains live input/read/status snapshots separately.
The whole execution driver refuses to overwrite evidence. Candidate and reviewer
frozen files remain unchanged; only new owned evidence is committed with explicit
`git commit --only` paths, preserving foreign staging. Stop after ROOT handoff.
