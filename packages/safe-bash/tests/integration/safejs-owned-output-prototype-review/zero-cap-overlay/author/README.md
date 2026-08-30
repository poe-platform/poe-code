# Zero-cap overlay — author freeze, August 27, 2026

**AUTHOR/FREEZE ONLY. NOT independently reviewed, NOT released for replay,
NOT production promotion. No runtime result is claimed.**

This leaf owns only this new `zero-cap-overlay/author/` tree and its regular TMP
copies. All live product/contracts/package/configuration, historical audit
evidence, shared snapshots and private checkout remain read-only. No dependency,
private install/build/query, guest/product/private-engine import, transport call,
native curl probe or external service execution occurred.

## Exact source derivation

Accepted `bb7f5972dd54df3ae9c05e745bfab1f1c38a0e29`, independently accepted at
`32debb6a`, changes one validation statement in `src/commands/network/shared.ts`.
The accepted commit's complete shared.ts preimage is byte-identical to frozen S1.
The derived complete file is byte-identical to the accepted shared.ts postimage.
`DERIVATION.json` binds both Git blobs and SHA-256 values. The complete accepted
Git diff is inert reference data; **only** `overlay/zero-validation.patch-data`
is the authorized product delta. No accepted README/tests/other source hunk enters S1.

Only the exact `maxRedirects`/`maxRetries` keys gain minimum0. All other limits
remain positive, maxTimeMs keeps its existing upper bound, defaults remain10/5,
and CLI clamping, curl effects, environment, regex/search and all other source
remain unchanged. No further production-path change was necessary or authorized.

| Inventory | Parent S1 SHA-256 | Candidate SHA-256 |
| --- | --- | --- |
| source213 | `6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea` | `2dc95c3abd7656de60d10a2f339a80d14d31ecc2b6d1a8f037769826cc8479f1` |
| compiled708 | `2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f` | `65dda12bcf3536eefb49745037b468e7ecbf424626d1d5db137a84e12bd9298e` |
| all940 | `a2632992e84344c1a6a92fcee181a1e6d535d6cb87ef1a9a7841e48af9c02e28` | `a7333f1942956f73a0cf7d16a35685f23a81186df18d89e55fe07e5a94b32b4a` |

Exactly four of940 entries change: shared.ts plus derived
`dist/commands/network/shared.js`, `shared.js.map`, `shared.d.ts.map`.
The other936 entries, including shared.d.ts, every other source, all tests,
configuration and package metadata, remain byte-identical. Full before/after
source, compiled and package inventories are in `inventories/`.

Final regular candidate: `/private/tmp/safe-bash-zero-overlay-author-2brs4bc_/candidate`.
Regular package709: the sibling `consumer/node_modules/virtual-bash`.
All changed exact public bytes are base64 data in `candidate-bytes/`; decode
before comparing the receipt's byte hashes. No private bytes are committed.
The parent940 plus these four decoded replacements independently reconstruct
the candidate. For source-derived reconstruction, use only the source patch,
the parent configs and authenticated copied tools, then compare all708 emitted
files and all940 candidate entries; never overlay live product inputs.

Pinned Node22.22.2 and copied TypeScript5.9.3 built708 outputs. The separate
noEmit check authenticated all358 compiler inputs (343 build inputs plus15
historical tests/helpers); only shared.ts differs from the parent compiler-input
receipt. Both configurations are unchanged. This is historical selected-input
public compilation/typechecking, not a current full gate or runtime acceptance.
`PREPARATION-ATTEMPTS.md` preserves bookkeeping failures and exact retained paths.
Author cumulative activity: two public emits and two noEmit checks; the final
candidate itself was emitted once. `CANDIDATE.json` counts its one candidate emit,
not the earlier refused preparation. Parser-only checks do not import harnesses.

## Frozen cohorts and exact expectations

The requested base remains **8 surface +11 lifecycle**, with **6 additional
zero-policy controls**:25 scheduled profiles total, none executed.

- Surface: the approved v2 child, case data, observer and scorer remain unchanged.
  Six supported surfaces, one reflection dialect profile and one observed-await
  rejection profile retain their original expectations. The dormant original09
  data and nine host-only observer controls are preserved, not extra scheduled
  profiles. A capability finding stops and routes to ROOT; no ninth guest runs.
- Lifecycle: all11 original row objects/expectations remain exact; approved v2
  child/common/guard and guest bytes are unchanged. The L05 selector remains the
  distinct13-byte `owned-guest\n)` actual-execution rejection. Both L06 host caps
  return from1 to0; all other limits, controls, effects and cleanup remain exact.
- Additional controls: three finite families, each open and stdout-closed. Every
  closed row requires successful `Z01-open` and its matched open control. The
  first non-pass blocks subsequent rows; no retry or deadline rescue is authorized.

All six use the exact frozen argv in `controls/CASES.json`: `-sS -T -`, body/header
VFS paths, numeric write-out, `-L --max-redirs 9 --retry 9 --retry-delay 0`, one
explicit HTTPS URL, and `--fail` only for the503 family. Host caps are both0.

| Family | Open / closed curl status | Required body effect | Response body reads |
| --- | --- | --- | --- |
| Z01:200 plus CLI override attempts | 0 /141 | replace sentinel with `body0\nbody1\n` | two chunks,12 bytes |
| Z02:503, Retry-After1, --fail | 22 /22 | preserve exact `zero-body-sentinel\n` | none |
| Z03:307, Location /next, -L | 47 /47 | preserve exact `zero-body-sentinel\n` | none |

All six must replace the header sentinel with the exact initial HTTP header
block. Z02 requires `curl: (22) HTTP response status 503\n`; Z03 requires
`curl: (47) Maximum redirects exceeded\n`; all retain `independent-stderr\n`.
Open write-out is `status|0|0|6|downloaded|curl-error-code\n`, followed by
`curl:status\n`; closed output omits only write-out. Z01 closed selects141,
whereas an existing curl failure remains22/47. Full byte strings are frozen in
CASES, not inferred from a generic assertion that every response creates a body.

Historical L06 requires body/header VFS files **and exact stderr channel bytes**;
it does not define a third stderr VFS file. This freeze preserves those exact
original effects rather than inventing a new file or weakening any assertion.

Each network row requires exactly one authorization and one transport admission,
attempt0, no redirectFrom, no additional admission, and one transport cleanup plus
one response disposal before nested invoke/public settlement. Journals precede
acquisition; extra entries are independently denied and still fail exact journals.
Reused upload storage is copied before producer advancement, the first-chunk gate
requires upload before EOF, and only stdout closes. New controls additionally
count response consumption, upload-source starts and finite1000ms retry-timer
requests. Retry-After1 is bounded; no waits, rescue or unsupported protocol/flag
assumptions are used to establish a pass.

## Review and release boundary

`fixture-deltas/` and `FIXTURE-DERIVATION.json` disclose every v2-to-new change.
Lifecycle semantic profile checks remain intact except the authorized zero-cap
expectations/labels. `admission.mjs` replaces historical candidate identity with
the exact new candidate manifest and committed freeze; it does not waive source,
package, tool, original-input, import or private-state guards. Historical surface
PINS/RELEASE remain reference material, not a new root release.

All three drivers require `ZERO_OVERLAY_ROOT_RELEASE` before private queries,
copying or child launch. It must name an externally owned regular JSON descriptor
binding this freeze commit, both candidate hashes, explicit ROOT authorization,
cohorts and output/TMP candidate/package locations. Its independently committed
review receipt must say `ALLOW_REPLAY_OF_EXACT_FREEZE`, bind the same freeze/hashes,
and name a reviewer other than this author. No descriptor or approval is supplied
here. `RELEASE-SCHEMA.json` is inert, not executable authorization.

Future replay must freshly guard private HEAD/tree/index/status/staging, six
metadata files and264 engine files with GIT_OPTIONAL_LOCKS=0 before/after. Existing
regular engine copies must match that closure; injection uses copied source hooks,
never installed private packages. Original per-cohort limits/deadlines stay intact.
Candidate/shared immutable bytes and metadata are re-enumerated, and new directory
shape guards additionally detect new files/directories/removals; no atime, atomic
intervening-state, hard-preemption, first-read promise or OS-sandbox claim follows.

Root must obtain a **different verifier's exact-overlay/fixture review first**,
then separately release replay. Author static checks are not that review. No
source promotion, current whole gate, universal parity, superiority, deployed
service, native curl or Linux-kernel acceptance is claimed. Original surface7/8,
lifecycle8pass1fail1invalid1blocked and later higher-cap8/8+11/11 captures remain
separate and immutable. Env review5ba1a0f3/ec4e264d is not repeated.
Any production rebase/write-set proposal belongs after the audit, not this phase.
