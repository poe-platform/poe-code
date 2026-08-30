# Functional-only reference proposal v1

## Decision requested

Review this source-only packet with a DIFFERENT literal-program/launcher reviewer; then decide a fresh host-test grant and specific tool approval. Nothing here authorizes execution. Proposed first stage: **37 unrun Bash 3.2.57 observations**, not product calls, not Bash 5.3, and not the old 9/40 containment cohort. All 40 original identities and exact inputs remain in AUDIT.json. No expected outcome is invented.

## Audit findings

- B26/B27: EXCLUDED/UNQUALIFIED. Published Apple Bash-3.2 redir.c calls sh_mktmpfd with MT_USERANDOM; tmpfile.c consults TMPDIR only with MT_USETMPDIR. Thus owned TMPDIR is insufficient source evidence for owned-only heredoc/here-string scratch. Published source is NOT a binary-matched build proof; exclusion is conservative, not an observed host write. No fixture rewrite or native retry is proposed.
- B28: EXCLUDED/UNQUALIFIED. The old packet calls exec descriptor-only without qualifying old-parser handling of {fd}. exec with an argument searches/executes a command; no installed-image parser outcome has been observed. Do not reuse that assertion. A separate exact version/source review is needed.
- B20/B21/B39: request EXPLICIT finite missing-name-lookup permission, not a claim that mapfile/readarray are Bash3.2 builtins. Only an empty newly owned absolute PATH directory is supplied; no successful external executable is allowed or present. These are useful version/error observations, not implementation passes. Root may refuse this extension, requiring a newly versioned selection, not silent dropping.
- B23: published 3.2 read.def lacks -N; retain its real diagnostics/status, not a rewritten -n program. B24/B36 syntax and B11 dot-entry behavior are version-sensitive. Nothing assigns their runtime outcomes.
- B37 sources exactly the 37-byte owned source-fixture with literal arg, then evaluates only literal v=eval. B38 executes only fixed EXIT body printf cleanup. No unbound eval, user scripts, external command substitutions, process substitutions, network redirections, background jobs, job-control escape, or absolute user-file operands occur in the 40 bodies.

## Exact input and host effects

The 40 decoded program strings total 2480 UTF-8 bytes. Four common fixtures total 43 bytes, mode0600, no symlinks; directory modes0700. AUDIT.json stores each program, stdin, fixture, SHA256, byte size and base64. REQUESTS.json seals exact future argv/env/cwd for each selected row. Programs are JSON-decoded once, not unescaped again; no prefix/suffix scripts are added.

B10–13 enumerate only owned work; literal globs are never used as command names or external operands. B23 creates/truncates work/out, at most one source-derived byte, then reads it; B25 writes at most two. Snapshot permits out only for these IDs and verifies original fixture identities/content/modes remain unchanged. B37 reads only the owned 37-byte source. B22 stdin is five fixed bytes; other selected stdin is sealed (including inert bytes for version-sensitive B20/B21). No child is given repository/capture/fixture-source descriptors beyond stdin/out/err. Admin staging/snapshot reads only the new root and sealed input files. System loader/default runtime reads remain an unobserved platform dependency: this is NOT OS read confinement or hostile-shell safety.

## Profiles and comparison

Pinned /bin/bash: 1293840 bytes,0555,SHA35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3. Prior Sagan metadata-only version receipt says GNU Bash3.2.57(1),arm64-apple-darwin25; no repeat probe. Node22.22.2 controller and env launcher are separately pinned. No sandbox-exec or claim that the failed Seatbelt profile works. Preserve 73020b3f/fb3609af SIGABRT/empty outputs and all historical unknowns unchanged.

A later separately authorized product comparison must use c83f352f/full950 archive SHA4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156, not live HEAD. The full archive was authenticated as DATA only; no extraction/import/build. Snapshot mapping replaces only the known case-root namespace with virtual / (work,home,tmp,empty-path); paths, types, modes and file bytes remain exact. Raw stdout/stderr, NULs, shell-name/line/path diagnostics, and numeric status are NEVER normalized. Syntax errors, missing features, API rejections and unsupported rows retain separate dispositions, never passes. Product MemoryFS fixture layout must match these existing original setup bodies; product execution remains separately blocked.

## Finite future recipe and limits

PROTOCOL.json: 600000ms inclusive, setup60000/finalization60000, one case at a time, target3000 + TERM2000 + KILL1000ms. Each output stream65536 bytes; total capture33554432 bytes; retained working134217728 bytes; snapshot32 entries/65536 per-file/262144 total. These are logical/sample-checked limits, not RSS, kernel quota, or a hard post-SIGKILL bound. Fixed literal outputs are finite; overflow/abortion/integrity/capture/unknown retirement stops dependent admission. Ordinary nonzero exits remain observations.

64 total planned OS starts = 1 controller + 37 direct Bash + 13 conservative internal reservations + 1 tool shell allowance +12 admin. env replaces its image with Node (not a second process start); track its executable role separately. Peak6 planning bound; source syntax permits at most two internal pipeline stages alongside one target, controller and tool shell. Internal reservations: B09=1,B14=1,B20=1,B21=1,B24=2,B29=4,B30=2,B39=1. They are source-bound allowances, NOT observed fork counts or an installed-binary lossless census. No Workers. No source has explicit escaping session/job control. Source review must accept these qualified bounds; hidden implementation forks are not disproven.

Owner creates raw journal before fallible admission and opens regular capture FDs before spawn. Direct child error/exit/close listeners are registered immediately; stdin is finite. Regular-file completion is reported separately from stream EOF (null). Trusted node:process kill binding tests only the new owned group; error fields/present/absent/unknown are preserved. Unknown is STOP, never clean; no historical group recheck. Exact sources for observers are copied byte-identically from the repaired readiness packet. Capture monitoring is sampled, not a kernel write barrier; groups are not universal descendant census. No automatic cleanup of old staging. New raw staging retained for review; descriptor/process cleanup is separate from evidence deletion.

## Next authorization boundary

GO.template.json is NO_GO. Root must accept independent review, issue a fresh deadline/grant and approve the exact sealed exec_command invocation with require_escalated, no prefix_rule. Do NOT call it now. launch.mjs is source-prepared, not executed or claimed validated; its actual lifecycle needs review and the future authorized observations. This is an explicit request for test-only host execution, not permission circumvention. No product fallback, OS-security qualification, global release result or Bash5.3 equivalence follows.
