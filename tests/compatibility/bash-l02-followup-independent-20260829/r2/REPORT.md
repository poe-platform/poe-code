# L02 r2 independent review — gate findings; r3 final disposition pending

Bound author8e78572c234c234c01469c852414f012349b5917, preseal3db721642c2c3ab82dbcc7fd4a73267a2f702682, execution profile b46dd4e58efdf4efb9244ae6beb1a046ab51c734a457a65ce7f898c1e5c2d808. No author changes and no product/Worker activation.

## Observed review scope

- Exact copied author controls:14/14. Their two sealed harmless Node children returned0/7, each with exit+close, both end/close events, complete captures, no primary/secondary or forced termination.
- New independently frozen input mutations:5/6 groups. N01 nested getters rejected without invoking getters; N03 required close roles/order; N04 duplicate construction/termination/exit; N05 unknown reference/charge/presence; N06 first undefined/null/false/0 journal reason plus critical reserve all passed.
- N02 FAILED honestly: setting either processRow.stdoutEnded=false or stderrEnded=false while preserving other baseline fields yields PASS. The field's type is checked, but true completion is omitted from the ownership conjunction. Minimal fix: require both true while preserving event chronology/descriptors. This is a validator-consistency defect, not an observed runtime capture loss.
- Author fixture constructor is explicitly reused as the baseline DATA builder; the six mutations/expected refusals were independently chosen and sealed before execution. No claim of pre-author hidden testing or actual Worker lifecycle proof.

## SOURCE-only ordering defect

supervisor.mjs:3 sets unconfirmedWorker only after judge, post-case census, output-cap, immutable-input and unexpected-name checks. If judge already returned STOP_UNCONFIRMED and one of those later checks throws, captureScope retains the primary, but supervisor.mjs:5 returns retainedUnknown:false because neither flag was set. admin-publication.mjs:2 only blocks on retainedUnknown and permits outer exit2. Thus known Worker uncertainty can be lost before the publication gate.

Minimum correction: latch STOP_UNCONFIRMED immediately after judgment, before fallible bookkeeping, and preserve it monotonically through cleanup/error publication. A separate conservative pending-lifetime flag (or independently authenticated retirement phase) is also needed for failures before receipt retirement is established; direct child closure alone is not that evidence. No supervisor or Worker was run to test this source route.

## Prospective bounds and ROOT r3 policy

The immutable r2 matrix is13 cells, layouts5/4/4, at most10 Workers, persistent double-fault built LAST.27 conservatively charged image-role slots are not27 observed distinct PIDs.600s includes180s publication reserve, peak3 conditioned on explicit exec replacement;64MiB capture/256MiB logical work are not RSS/OS quotas. UNKNOWN must retain references and prohibit later cells/ordinary archive/publication.

ROOT now explicitly permits trusted initial startup redirected to owned files before Node with reservation+postcheck, NOT prewrite enforcement/stream EOF/security. Shared Git internal physical storage is trusted/unobserved and excluded from the logical-work cap; owned Git streams/tails and known start/close still must be bounded/accounted. The r3 author is adding the missing131072 publication outer channel allowance and a qualified versioned close schema. If other terms stay equal, capture allowance becomes6078464 and logical working allowance21594112. These policy choices do not waive F01/F02 or prove Worker retirement.

Final PREEXEC verdict is deferred until exact r3 source/profile binding is received. The prior49555c99 and earlier actual STOP/unknown cohorts remain unchanged. This review has no actual GO.
