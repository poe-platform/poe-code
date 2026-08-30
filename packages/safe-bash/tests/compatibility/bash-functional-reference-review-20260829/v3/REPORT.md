# Final narrow v3 review

Date: Saturday, 2026-08-29. Independent reviewer: Sagan, distinct from Faraday.
The actual verdict and exact artifact hashes are in SCOPED-RECEIPT.json; this
report does not substitute source inspection for a completed DATA result.

Source4eea354169492b4c47d373d504e5918e1c4f3830;
evidence73065e68469e2e514c0ee87ff34ac1db04ba51cb;
PRESEAL5602bytes/SHA256ffee6eafb226ead4f9a15351c2964693971dfff7004b0d96cd6f9d0ca6098533.
Approval-template SHA2569243e5eb6c3db5fce5bee733740a2f59c0d8d447f1e3e38fe46fd476db00f6b7.
Request SHA256e69d98fc697e20462193d7e5a794537394fa66004ee685da3a8da401ea50c22d.

## Narrow changes

Storage.terminal checks the inclusive final deadline before open/write/flush
and after cleanup. A call already beyond the final deadline performs no
publication operation. Expiry during serialization/open/write prevents the
next publication step; independently attempted descriptor closure does not
make late output qualified. Original publication error identity survives
secondary close failures. Unknown/failed closure remains unqualified.

creditObservation checks both before and after its record operation; an event
written while a syscall crosses the deadline does not increment the returned
completed count. Entry uses that helper, removes the unbudgeted stderr fallback,
and retains publication/cleanup failure state without manufacturing compliant
late captures. Existing raw files remain evidence, not late successful results.
These checks cannot preempt a synchronous host syscall or retract bytes already
written by one: late completion remains refused, not a hard syscall deadline.

Initial tool-shell startup is explicitly TRUSTED HOST outside child fresh-env
and owned raw-capture qualification. That exact scope appears in protocol, GO
template, admission validation and approval justification. This implements
ROOT's decision, not a new clean-startup or OS-containment claim. No startup
file was inspected or modified. Node-launched Bash children retain exact clean
six-key env, owned HOME/TMPDIR/empty PATH and --noprofile/--norc.

## Proof roles and history

The sealed final DATA attempt runs the same six author controls and six novel
groups. Novel checks cover final-versus-body deadline, serialization/write
expiry, primary/secondary identities, unknown cleanup, credit refusal, strict
startup scope, wrong review/slot/path rejection and acyclic hash dependencies.
No entry/lifecycle/Bash/engine/product module was executed; no nested children.
Capture, lifecycle, group observer, observer-state and tool/version bindings
match v2 exactly. The previous qualified v2 lifecycle/FD derivative observations
remain applicable only to those unchanged components and wrapper structure;
no new runtime entry or wrapper execution is claimed.

Both reviewer defects remain: first treating author-evidence rows as source
rows; then expecting an array rather than the declared result envelope. R3
captures and validates the envelope exactly. Prior failures/returned-but-
unqualified DATA are not silently erased or added to the final denominator.
The historical v2/N08 defect result remains unchanged.

## Required future authority order — no cycle

1. Freeze source/preseal and this completed independent review evidence commit.
2. ROOT accepts this scoped verdict and publishes the mode0600 runtime receipt
   in the author scope, with profile/schema v3, source/request hashes, reviewer
   identity and this evidence commit as reviewCommit. That receipt is not part
   of the earlier evidence commit whose hash it references.
3. ROOT publishes fresh mode0600 GO.json: exact receipt path/bytes/hash/mode,
   preseal identity, approved startup scope, unchanged limits, fresh deadline.
4. Replace ONLY ROOT_APPROVED_GRANT_SHA256 in the frozen command template with
   the raw GO file's 64 lowercase hexadecimal SHA256. Publish the resolved
   command for a separate DATA-only slot check; no engine/native pilot needed.
5. Authenticate source/tools and preprovisioned directories/captures again.
   Only then may the author issue the exact require_escalated tool request,
   login:false, fixed /bin/zsh, no prefix rule, disclosed trusted-host startup.

The source preseal excludes actual GO/accepted receipt/resolved-command files;
the GO must not acquire a hash of the command that already contains GO's hash.
No other command field/path/options/limits may change during slot resolution.
This review creates no real GO, resolves no actual slot and requests no tool
approval. The generic scoped receipt is deliberately not runtime admission.

37 native observations remain UNRUN, B26/B27/B28 withheld. Only the three
approved literal failed lookups in owned empty PATH remain permitted. Local
3.2.57 is not GNU5.3; old containment HOLD/P2 remain. Ceiling80/peak6 describes
known managed roles, not all forks or a hard OS quota; owner1+37 direct cases,
zero administrative children,13 separate source fork reservations. Ten minutes
includes terminal/publication tail; no late-write allowance was created.

All owned review processes retired. Metadata, DATA helpers and publication
remain separate from target process counts. The finite forty-known-start
review allocation is exhausted at publication; no further actions are implied.
