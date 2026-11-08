# Reviewer preflight chronology

Before any author semantic execution, the reviewer's authentication helper
incorrectly required `/usr/bin/tar` to be a regular file. This explicit system
tool is a symlink to `bsdtar` on this host. The first bootstrap failed with
`AssertionError [ERR_ASSERTION]: /usr/bin/tar`; no author code ran.

The intended correction patch was rejected by apply_patch. The combined shell
command nevertheless continued, freezing the still-original helper under the
unfortunately named `BOOTSTRAP-CORRECTED.json` and rerunning it. That same
reviewer initialization failure is preserved in `PRE-AUTH.stderr.data` and
`PRE-AUTH.exit.data`. The first failure had the same terminal stderr and exit1;
only this second identical failure has a redirected raw capture. The original
helper is retained byte-for-byte as `authenticate-initial.mjs.data`; both early
bootstrap hashes bind that original, not the later corrected helper.

The subsequent successful patch changes only metadata hashing of the explicit
system tar tool to resolve its real path. It does not follow any candidate,
historical, buildview or package symlink. No author code, assertion, limit,
budget or prerequisite was modified or retried. `BOOTSTRAP-READY.json` binds
the actually corrected reviewer helper before its authentication run. These
are reviewer helper mistakes, not candidate/control failures, recovered author
rejection logs, or passes. The author semantic runs are separate and single-shot.

The first immutable postcheck reauthenticated sealed files, original fixtures,
DU75 frozen files and tools, then failed its overly strict whole-index equality
assertion because other owners had committed concurrently. This failure is raw
in `POST-AUTH-FAILURE.json`, not hidden or called a pass. `post-reconcile.mjs`
is separately pre-bound for metadata/immutable-archive checks only, without
rerunning any admission/control phase. It identifies the original index exactly
as committed9cccda89, checks the current index against its current HEAD, records
foreign committed paths and requires all protected paths to remain unchanged.
Unrelated concurrent commits do not invalidate immutable archive admission.

The frozen settlement helper also emits an unconditional success-template
sentence in `SCRATCH-RECEIPT.json` about retained reproduced package bytes.
No such package exists in this stopped run. Raw output and executed helper are
preserved, and `SETTLEMENT-QUALIFICATION.json` explicitly corrects that sentence.
The compressed scratch receipt contains only the three actual controls entries,
not a build or package. No assertion or author implementation was altered.
