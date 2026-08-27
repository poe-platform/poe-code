# Curl zero-cap author evidence

Candidate: `bb7f5972dd54df3ae9c05e745bfab1f1c38a0e29`, parent
`219790c55c0214e6d46524bbdced63c18c360f62`. The candidate changes only
`limitsFor`, the numeric-range/zero-semantics network documentation, and the new
canonical offline test. No executor, argument, body, transport, type, shared-input,
package, export, root configuration or AGENTS changes are included.

The immutable marker was published immediately after that candidate commit at
`/tmp/curl-zero-caps-author-candidate.txt`, SHA-256
`85dbbcbe8be177b9b27de29ee944577f04b3c4d6c7b03255adf00b4c9aa7620e`.
`candidate.json` preserves its exact content; subsequent results are separate.

## Results and boundaries

| Cohort | Passed / total | Failed / skipped / TODO |
| --- | --- | --- |
| Initial author suite | 125 / 128 | 3 / 0 / 0 |
| Final live author suite | 138 / 138 | 0 / 0 / 0 |
| Existing selected nonnative regressions | 63 / 63 | 0 / 0 / 0 |
| Packed public author replay | 138 / 138 | 0 / 0 / 0 |

Live build and scoped strict checking succeeded. The archived candidate also
built, packed, installed offline, and passed strict NodeNext public-consumer
compilation. Packed execution used plain Node without tsx/source loaders and
resolved both root/network imports inside the moved installed package. The packed
138 cases repeat the author's suite: they are **not independent holdouts** or 138
additional unique semantics. No native curl recapture, historical-gate rescore,
deployed service test, superiority judgment or 72-hour completion claim is made.

The initial three failures were author expectations, preserved in
`initial-results.json`: Shell obtains an external stdin iterator while taking
ownership even when curl never reads it. Only those iterator-open expectations
changed; zero producer reads and no transport/VFS opens remain required for denial
and abort controls. The final suite also adds ten direct/Shell cases for cached
replay, override snapshots, positive-cap exhaustion and retry redirect-counter
reset. The initial 128-test cohort is retained, not replaced by selected passes.

`packed-NEj63s/report.json` retains the first harness failure: listing the entire
repository exceeded Node's default subprocess output buffer (`git ENOBUFS`), before
candidate extraction/build/testing. The harness was corrected to list only its
explicit candidate input paths, not to raise a broad output limit or change test
expectations. `packed-qPj7k0/report.json` is the successful subsequent capture.
The failed report's generic integrity description is not a performed integrity
check: it contains no before/after inventories. The successful report contains both.

## Asserted effects

Each matrix cell runs a fresh direct command and actual Shell/plugin fixture with
an injected transport, MemoryFileSystem and a guarded maximum response count.
Both-zero requests assert authorization attempt 0, one transport, one response
disposal, exactly one 1,024-byte upload (stdin or file), and no additional producer
read, file open or cached replay. The 512-byte replay cache is smaller than that
initial upload; the upload quota is exactly 1,024 bytes. A separate 2,048-byte cache
case checks replayable stdin. A transport that declines to consume stdin is also
valid: zero does not require initial reads.

The status matrix covers 200, 301/302/303/307/308 and all six retry statuses
408/429/500/502/503/504, attempting CLI increases to `MAX_SAFE_INTEGER`. Retry-After
3,600 seconds exceeds the explicit 0.2-second deadline: zero retains the response
rather than timing out in a retry sleep. Tests assert exact body/header files,
write-out metadata, errors, suppression under `--fail`, and body preservation under
`--fail-with-body`. 307/308 without `-L` and missing Location remain normal initial
responses; thrown transport errors retain codes 6/7/56 and private-detail redaction.

Positive cap one controls assert two requests, refusal of a third, independent
redirect/retry ceilings, next-hop authorization/denial and cross-origin credential
stripping. Defaults execute eleven redirect requests before 47, six status attempts
with requested retries, and one attempt without CLI retry. Negative zero, both-zero
multi-URL execution, constructor boundaries, all other positive-limit boundaries,
and the timeout ceiling are checked. Three outcomes also compare host-zero behavior
against CLI-zero under positive host caps, without changing product/oracle selection.

## Reproduction and data classification

Canonical source test (does not write captures):

```sh
node --import tsx --test tests/commands/network/zero-caps.test.ts
```

Explicit packed author capture (always creates a new unique directory):

```sh
node tests/commands/network-zero-caps-author/verify.mjs bb7f5972dd54df3ae9c05e745bfab1f1c38a0e29
```

`verify.mjs` and `offline.mjs` are opt-in harness source, outside `.test.ts`
discovery. `candidate.json`, `initial-results.json`, `live-01/*` and `packed-*/*`
are captured data, not TypeScript source or native fixture inputs. No candidate
source copies, dependency trees, compiled consumers or duplicate tarballs are
retained. The harness archives only committed `src`, package/lock, build/root
tsconfigs, README and LICENSE inputs; it never overlays live product files.
The committed canonical test is adapted only by replacing its two source import
specifiers with public package imports. The report records both byte hashes.

The harness uses installed local TypeScript and Node typings, offline npm with
empty task-owned HOME/config/cache, and injected transport. Runtime guards block
ordinary Node HTTP/HTTPS/socket/fetch and child-process entry points and are
negative-control tested; this is not an OS sandbox/security boundary. Existing
safety regressions separately use controlled loopback HTTP and the late-policy
regressions spawn/reap two Node children. None invoke native curl.
Tool versions were Node 22.22.2 and TypeScript 5.9.3; a post-capture `npm --version`
check reported 10.9.7. No OS-native semantics or provider behavior is inferred.

The successful report re-enumerates before/after source and installed-package
names, directories, modes and file hashes, detecting additions as well as edits or
deletions. The source comparison excludes only generated `dist` and `node_modules`;
the installed package has no exclusions. This is before/after integrity, not proof
against transient concurrent mutation. Both capture attempts removed only their
own unique scratch directories. Existing foreign dirty paths and Sagan's frozen
S1 TEMP audit, 0-to-1 profile, old prototypes and receipts were untouched.

Exact commands, log hashes, tool versions and candidate hashes are recorded in
`candidate.json`, `live-01/manifest.json` and the packed reports. These scoped
results qualify this candidate's bounded enhancement, not the repository's full
current gate or any independent verifier's separate results.
