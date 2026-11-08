# Independent pinned-service continuation, not executed

All cases below are **pending / unmeasured**, not passes. Await the author's frozen
actual-service checkpoint and explicit RESUME. Reuse approved pinned service
artifacts rather than duplicating downloads. All future installation, server roots,
TLS fixtures, instrumentation, consumers and traces must remain in this owned
subtree; author code and evidence remain read-only.

## Primary WsgiDAV 4.3.5 call order

The exact primary texts and SHA256s are in `evidence/primary/sources.json`, fetched
from the official `mar10/wsgidav` repository's `v4.3.5` tag. Line references below
are to those retained bytes, not a different installed version or web-rendered
line numbering. Compare the eventual loaded wheel sources before attributing
these conclusions to the running service.

1. `http_authenticator.py.txt:189` authenticates through the configured domain
   controller or challenges the request. Middleware order is configurable
   (`wsgidav_app.py.txt:231`); therefore record the actual instantiated stack,
   not merely a claimed Basic header. RequestResolver chooses RequestServer
   (`request_resolver.py.txt:222`); server OPTIONS wildcard/root hotfixes can
   bypass provider request handling and must not count as a positive probe.
2. RequestServer sets `wsgidav.user_name` from authenticated state and invokes
   `provider.custom_request_handler` around the selected real method. This is
   the outer location where the observed author provider serializes requests.
3. `request_server.py.txt:548` DELETE observes the resource, rejects invalid body
   and collection Depth, evaluates conditional headers, then checks write access
   on its parent (or the resource if there is no parent). Only then does it call
   `res.handle_delete()` at line 601.
4. A handled success or exception returns the native-hook result. Otherwise the
   server obtains descendants at line 618 and enters recursive deletion paths.
   Stock `fs_dav_provider.py.txt:293` uses `shutil.rmtree`. An empty-only hook must
   not return False or fall through on an error. The observed author hook raises
   if descendant visitation is reached and uses only native `os.rmdir` for the
   extension effect; ordinary non-extension DELETE remains ordinary DELETE.
5. The observed `AtomicFolder.handle_delete` separately calls the actual provider
   lock manager at depth infinity before native rmdir. This is necessary because
   the early stock DELETE parent check is not a complete target/descendant lock
   check at this hook point. Successful removal then cleans properties and locks
   nonrecursively before producing the exact receipt.

## Lock transaction analysis: requirement remains open

`lock_man-lock_manager.py.txt:209` acquires the manager write lock around grant
creation and releases it on return. `check_write_permission` at line 420 acquires
a read lock, inspects actual lock storage, and releases that lock at line 492.
It does **not** keep a lock held until `os.rmdir`. Refresh and release operate on
storage as separate calls. Consequently a successful permission check alone is
not a check-and-delete transaction.

The observed author provider has a real `threading.RLock`, not a sidecar token
table, and holds it in `custom_request_handler` while yielding from every method,
including ordinary LOCK/UNLOCK, not just extension DELETE. In a single process
with one provider instance and all relevant mutations dispatched through that
instance, this appears to serialize actual HTTP lock mutation against parent/target
checks plus native rmdir. This is a source inference, not a measured race proof.

The serialization domain is not automatically the manager's entire domain:
another provider instance, another process, direct host calls into the manager,
or a second URL mapping with different lock roots can bypass or disagree with it.
Sharing a manager object alone does not canonicalize URL lock roots. A legitimate
alias to the same native root must not be called disjoint storage just because it
has a new provider, route, binding object or mutex. The actual configured mapping
must either preserve the appropriate shared lock authority/serialization or reject
an unsupported configuration before extension effects. No new public transaction
API is demanded here and no malicious-callback sandbox is assumed.

Native/alias writers that do not honor DAV locks remain relevant to emptiness:
the native empty-only primitive must reject a child introduced after observation
without deleting it. This is distinct from DAV lock authorization and from full
pathname/ancestor replacement or ABA protection, which this source contract does
not promise. Record those boundaries rather than treating a lexical check as a
descriptor-relative namespace transaction.

## Required instrumentation and frozen setup

- Pin the author service commit and exact hook/client/config bytes. Keep original
  author cohorts unchanged. Compare observed dirty copies separately; do not
  present them as frozen author inputs. Record wheel/dependency and loaded Python
  source hashes, runtime versions, effective middleware, actual provider mappings,
  native root device/inode and actual lock manager/storage implementation.
- Build/extract the frozen candidate package into a differently named consumer as
  in phase 1; record actual loaded module hashes again. Any new author source
  checkpoint requires a separate source-delta decision, not silent substitution.
- Observe real `acquire`, `refresh`, `release`, `check_write_permission`, hook entry,
  descendant visitation and native rmdir entry/return in the owned service process.
  Do not replace them with a fake lock table or canned HTTP response. Instrument
  delegating calls and scheduling gates only, retaining original return/error
  behavior and disclosing the exact wrapper delta.
- Gate after successful parent/target permission checks and before native rmdir.
  Record when a competing authenticated request reaches dispatch, when it enters
  the serialization domain, and when the real manager state changes. A pending
  client request or accepted TCP connection alone does not prove serialization.
- For every mutation case preserve before/after directory entries, root identities,
  child bytes/hashes, complete status/receipt/errors and ordered provider events.
  Cleanup is a separate harness action after evidence; it cannot disguise fallback
  recursion, rollback, or request-side effects.

## Concrete holdout matrix

| ID | Setup and action | Required observation |
| --- | --- | --- |
| AUTH-1 | No Basic credentials and then wrong password; call probe and removal through public binding | Actual authenticator challenge, no successful capability negotiation, no DELETE effect/native entry; typed authorization failure where applicable |
| AUTH-2 | Authenticate legitimate `other` principal not allowed by extension | Actual authenticated principal reaches extension policy, 403/EACCES, unchanged directory; a header string alone is not proof |
| HOOK-1 | Empty directory, normal allowed principal, real extension | Standard parent check then target/infinity manager check then one native rmdir; no descendant enumeration or stock recursive delete; matching receipt |
| HOOK-2 | Existing child with bytes `00ff80410d0a` | ENOTEMPTY with child/directory intact, no traversal/deletion, no retry or rollback |
| RACE-1 | Pause after metadata/permission checks at native gate; create child through owned native alias; release | Actual os.rmdir rejects nonempty; preserve exact late-child bytes and entry; no recursive fallback |
| LOCK-1 | Acquire genuine exclusive target lock using actual LOCK as another principal; invoke extension without token | Actual manager rejects target lock, no native rmdir, target/lock intact |
| LOCK-2 | Acquire real parent depth-zero and ancestor depth-infinity locks separately | Applicable parent/ancestor protection enforced before native effect; retain exact ref URLs and manager records |
| LOCK-3 | Acquire lock on a real child within a nonempty target | Actual depth-infinity check rejects child conflict; no descendant visitation/native mutation; do not substitute nonempty-only behavior for lock proof |
| LOCK-4 | First grant real target lock, then contend extension DELETE | Grant is visible to real check; DELETE cannot pass as though unlocked |
| LOCK-5 | Gate DELETE after actual target check, then submit authenticated target LOCK | Competing request demonstrably arrives, but no grant/state mutation occurs inside check-to-rmdir interval; after release record whether LOCK fails or creates a new lock-null resource distinctly from original directory removal |
| LOCK-6 | Repeat gate with relevant parent/ancestor LOCK, refresh and UNLOCK | Ordered real state mutations agree with declared serialization domain; no claimed manager transaction from a released read lock |
| LOCK-7 | Wrong, expired, wrong-path and wrong-principal actual tokens; separately valid owner token via direct authenticated protocol control | Invalid cases preserve namespace; valid protocol control uses actual manager, not made-up acceptance. Public sample does not currently offer a token option, so do not invent one |
| PROBE-1 | Stock endpoint or extension-disabled provider, with extension client explicitly configured | Missing/incorrect capability yields ENOTSUP before DELETE; stock adapter omission remains ENOTSUP; no ordinary recursive DELETE fallback |
| PROBE-2 | Correct OPTIONS status but missing/wrong version/namespace capability; root OPTIONS hotfix; redirect/auth failure | Client refuses without mutation and without redirecting credentials. Clearly separate altered-response client guards from real disabled-provider observations |
| PROBE-3 | Wrong configured canonical namespace, Host, query, path attestation or operation; mismatched valid namespace with unchanged backing mapping | Construction or provider preflight refuses before effect; no interpretation as a new disjoint store |
| ALIAS-1 | Truthful second public view of same backing file/directory | Public comparison returns same where authority is present, otherwise unknown; never distinct from adapter/route identity alone; guarded copy preserves bytes |
| ALIAS-2 | Ordinary same-backing provider route/instance alongside extension; grant actual LOCK through alias and contend DELETE | Establish shared canonical lock authority and serialization or explicit unsupported binding before deletion; independently document any route-root or per-instance mutex gap |
| TYPE-1 | Root, missing target, file, final symlink, symlink ancestor, noncanonical path, replaced configured native root | Normal error/path and unchanged namespace; no native deletion via wrong ordinary mapping. Do not claim arbitrary ancestor-race confinement from static checks |
| OUTCOME-1 | Delay/cancel after dispatched native effect; truncate/drop/mismatch receipt | ECANCELED/EIO/timeout as appropriate, actual effects recorded, exactly one dispatch, no retry, recreation, or absence guarantee; observe late rejection |
| REGRESS-1 | Replay original author service and relevant original stock/COPY/MOVE cohorts unchanged | Preserve original inputs, denominators and failures; qualify helper changes separately; never revise original stock 78/79 to a new extension profile |

This matrix intentionally includes both real-service controls and explicitly
identified transport-response holdouts. Passing the latter cannot substitute for
the former. No row has been executed in this phase.
