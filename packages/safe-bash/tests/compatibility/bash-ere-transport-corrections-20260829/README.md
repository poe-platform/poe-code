# ERE transport corrections — code-author checkpoint

2026-08-29. ROOT changed this agent from independent reviewer to code author. A different reviewer is required. Original Plato artifacts and independent2e9deaab remain immutable. Only four of the seven authorized private transport files change; no engine/runtime/Expr/public edits.

Pinned original transport0f36459ccf38623906c5c80702c5d32111167f4d; pinned engine b5f2464f63172fc7c92bcfd33fbb2a8a6d8c03eb. Later Plato R01 work MUST be rebound and rechecked separately. Do not compile against moving engine HEAD.

## Corrections

- Queued abort has an owned listener/recheck, removes its ticket and retires reservations without Worker acquisition. Active abort closes admission through a distinct CLOSED root failure, retires the one Worker, joins waiters, then selects the request's raw signal reason, including falsy values. Sibling requests do not receive that local reason. No replacement Worker/retry is introduced. An active cancellation necessarily leaves the single-Worker root unusable; queued-only cancellation does not.
- Owner close rejects internal ready/request waiters, clears timers, observes their rejections and joins them independently of termination, exit and stdout/stderr end-or-close. Startup/request wrapper promises join close on failure. Root failure owns idle retirement too. Cleanup failure is retained in the retirement promise, never cached as a substitute root-close barrier; unconfirmed retirement is not clean or refunded.
- Input/reply array traversal and copying use own indexed descriptors, never caller iterator/map methods. Fragments and spans are copied and only owned copies frozen. No global prototypes are changed.
- Known root/session/ticket/owner/usage and descriptor/index scratch cells receive explicit T/H charges; bootstrap has scalar admission before child records. The wire47+4n+p+s and479 reserves and engine-derived A/W ceilings stay unchanged.

## Remaining ROOT policy blocker

**Exact own-key enumeration has no bounded JavaScript primitive.** Reflect.ownKeys creates a list before its cardinality can be examined. The revision precharges the admitted schema's key-list/descriptor units, retains strict extras/accessors/holes/proxy refusal, but cannot honestly pre-admit an arbitrary caller object's excess nonenumerable key list. No exception is silently ratified. Either ROOT explicitly classifies native key enumeration as excluded VM internals alongside already-excluded native cloning, with logical post-enumeration refusal, or specifies a trusted already-shape-admitted input boundary/other qualified primitive. This checkpoint is HOLD on complete S04 conformance pending that choice and independent census review. No whole-host allocation/RSS claim.

## Finite validation authority

PRESEAL.json + run-validation.mjs seal source/tools/pinned engine/types/pure helper before execution. Three compiler processes (strict source with declarations, positive, negative) and one Node DATA process with12 controls are planned. One additional compiler and one additional DATA process are ceilings, NOT automatic retries. Type intentions: positive exit0; negative exit2 with exact TS2353,TS2322,TS2345. Existing24-emission history is not an oracle for new output membership; the owner inventories actual emissions.

The only executed product imports permitted in the DATA helper are accounting, validation, protocol, limits and errors; synchronous registerHooks authenticates actual loaded source bytes and rejects any other file. No owner/root/Worker-entry/wire-engine/matcher/syntax import. Twelve controls are finite bounded synthetic data, not Worker controls. Original32families/60variants and lifecycle/stream/loader proof remain UNRUN.

Launch after atomic preseal: pinned Node path from PRESEAL.json, absolute run-validation.mjs path, exact SHA256 of PRESEAL.json as sole argument. RUN-v1 parents are provisioned under already-open preparation capture before launch. Controller opens independent stdout/stderr before reading seal; every child close/error handler is installed immediately after acquisition. Both captures close independently with primary-presence preservation.

Known role graph: existing Node tool-host (not newly acquired), administrative Git/apply_patch children, one sealed Node controller, up to3 planned tsc children and1 pure Node child sequentially. No deliberate nested tool children. Limits30min/64knownOS/peak4/96MiBcapture/512MiBwork include publication; inner480s/4children/16MiBcapture/256MiBwork are stricter. Compiler120s, consumers/helper30s. Tool/npm241-file envelope is static, not dynamically minimal. No network/private/native/engine matching/Shell activity. Source and tool copies are regular files only.

Original64 administrative compliance remains NOT CERTIFIED. New correction receipts do not rescore it.
