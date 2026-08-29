# B2-r7 independent loader-delta PREEXEC review

## Verdict

ACCEPT, scoped permission-compatible trace mechanism and prospective r7 bindings.
No actual 672 grant, semantic acceptance, fixed window or product execution.
Candidate `5d60457781b73783eecdd61e34d33ec7916d891b`, evidence
`b7b30c3855e6e981e8a06f209bbaec83d65fa427`; packet 6519 bytes / 31 members,
SHA256 `f97901065a7803f72edb92c19f219e66f35dc2f050917d10dd25cb411ba5f65a`.
Author receipt SHA256 `89df82217c7c39437f8b10bc3ede094012759d77c154031cc3f579ee8e246d26`.
Independent preseal commit `15a204f63`; seal SHA256
`dd905a64e082c513a7710b49517df7ece6c6cf88d331e5869dc47ffea1488abf`.

## Actual evidence

Eight unchanged author fault groups plus six independent groups PASS (14/14):
short complete writes; zero/oversized progress; write false/undefined; close
zero/undefined; primary-before-close; cumulative cap; sticky null failure;
replacement inode; mandatory exit/close; incomplete JSONL; changed trace digest.
N06 establishes different content produces a different digest, not an automatic
comparison against a preexisting expected trace digest.

H01/H02 actual harmless consumers PASS, PIDs 28405/28406, sequential,
2026-08-29T15:40:58.588Z–15:40:58.730Z. Each exited/closed 0 without signals;
literal stdout `B2-R7-ONE\n` / `B2-R7-TWO\n` is separate module-evaluation proof.
Each stdout is 10 bytes, stderr is 807 raw warning bytes. Complete post-retirement
traces are 216/436 bytes and contain one/two matching prepared-source hashes.
Two async-loader admissions, one live. Individual loader exits/native helper
thread census UNOBSERVED; only hosting process exit/close observed. Zero product,
Regex, guest, native, compiler, install or retained-case calls.

## Source and identity conclusions

`staged/new/trace.mjs` checks every write count is a positive safe integer no larger
than remaining bytes, loops to completion, checks resulting size, and attempts
owned close even on write failure. Exact falsy primary values survive close
failure. The secondary close reason is not separately exposed by this trace API.
Failed traces cannot resume. Appending requires same device/inode and expected
length, with NOFOLLOW. The cap is 524288 bytes per role; bounded JSON allocation
precedes the check, so this is not arbitrary-input constant-memory proof.

Loader `load` hashes admitted source before recording
`authenticated-source-prepared`; the record precedes source return, NOT evaluation.
No fsync remains in this loader trace path. Parent capture/publication fsync in
support code remains intentional. No crash-durability or filesystem atomicity claim.
`verifyRetiredTrace` requires exit+close, regular bounded file, stable opened
identity/size/mtime, complete fatal-UTF8 JSONL and returns the exact bytes' SHA256.
`classifyMutant` requires matching prepared mutant source hash AND exact defect
failure. `classifyRestore` requires matching original hash AND actual case success.

All 34 author preseal entries reauthenticated before controls and after retirement;
packet/receipt and pinned Node112989184-byte binary hash authenticated. Package
930368 bytes / SHA256 `2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca`
reauthenticated without decoding. Reuse prior full r6 SOURCE/DATA qualification:
309 source /1012 emissions /1014 shipping, 672 unique fixtures, 6 type groups /
24 diagnostics, 7 mutation/restoration pairs and 2 bindings; NOT freshly executed
or recensused here. The literal permission argv line matches r6 exactly. Harmless
consumers use the same flag/environment templates with only owned roots changed.
`--allow-worker` remains the existing fixed trusted-source profile, NOT a claim
that Node permissions independently prevent arbitrary Worker code from hostile
application modules. Static loader/support/trace dependencies are packet-bound.

## Limits, history and future authority

Known-role-only profile. Final conservative charge is 29 known OS roles including
instruction readers, shell/edit overhead, DATA/admin/Git, controller and two
consumers; observed nested control topology <=3. Not a full descendant census.
Startup's early role ordinal is not a final census. Direct-file startup capture
preceded metadata/helpers; instruction reads were separate and never copied.
Tool transcript views were truncated; complete raw files are retained unchanged.
No capture loss, unknown owned retirement or safety failure observed. Logical
snapshot in PUBLICATION.json excludes Git internals/RSS/physical allocation.

Original `43a1c3dc` remains 0/672: one 246-byte trace before fsync failure, not
completed supply/evaluation. Original EEXIST, scheduler/timer and author DATA
publication correction histories are not rescored. Prior r6 full review is reused
only for unchanged scope; this is not a new full source census or 672 pass claim.

Future r7 ROOT/review/timestamps remain null; runtime root, outer capture and GO
path were absent at 15:41:36.922Z. Require new binding packet tying this review,
31-file packet, all role/tool/source/package identities and unchanged permission
profile to a fresh root grant. Recheck absence/owner/modes and full residual window
at launch. Proposal remains 64 known OS roles (1 owner+41 children+22 admin), peak3,
34 loader admissions/one live, Regex0/guest0, 1800 seconds including 180 publication,
96MiB capture/512MiB logical work. No fresh window or automatic runtime authority.

Pending command only:
`/bin/zsh /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r7/staged/new/launch.sh /private/tmp/B2-R7-ROOT-GO.json 6519`
Repo cwd, login:false; initial trusted tool-shell boundary unchanged.
