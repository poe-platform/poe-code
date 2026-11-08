# Bounded source-author checkpoint: default LOCK interoperability

August 27, 2026. This is implementation evidence, **not independent acceptance**.
Root must assign a different final verifier. No universal interoperability claim.

## Source and baseline

- Original real-service source baseline: `1ea140b50f0b4edcfa28a60e2f89351b97e509a5`.
- Earlier timestamp fix: `4143efde6de0b5cff4feff03f0a479cd70b9510f`, retained unchanged.
- Immutable earlier author checkpoint: `a4c7824ef62e5e053218c234c373d93999ff46c9`.
- Requested phase-two baseline: `76d1dd721f8b6efc9417b847e14d674cf9cbae0f`.
- LOCK compatibility fix: `0e69b39a61cd94d8bb5897be4bc863dd6b0201dd`.
- Direct-authority fix and final frozen product source: `93c009df1d3de38207d0000b451839f29fa898f6`.

The shared checkout was not clean. Each service cohort archives the explicit
commit, builds that isolated tree, and records the contemporaneous shared status
without copying unrelated dirty source. This author changed only WebDAV source
and this new evidence subtree. No root exports, contracts or other filesystem
implementations were changed. Atomic source commits precede final service replay.

## Two measured product fixes

**Legacy new-LOCK binding.** The original Apache default COPY/MOVE failed solely
because its new grant omits DAV:lockroot. RFC2518 8.10.1/9.5/12.1 bind a new token
to the Request-URI and define activelock without that newer element. RFC4918
9.10.1 retains request binding and 14.12 says the server SHOULD include lockroot.
The absent-only rule accepts that older grant, not an explicitly wrong/empty root.
See `LEGACY-RULE.md` and primary URLs, source-tag excerpts and document hashes in
`evidence/legacy-primary/sources.json`. There is no WsgiDAV delimiter allowance.

The regression uses the original actual Apache XML. Before editing: 20/22 pass,
2/22 fail (`legacy-before-fix`, immutable input text/hash). Final expanded suite:
23/23 pass, including late cancellation. It retains coded token/XML equality,
exclusive/write/depth-infinity/finite timeout, status, namespace, explicit root,
same-origin/scope/redirect and cleanup checks. Default policy is still `lock`.

**Direct transfer authority.** The real pre-fix cohort at the first source commit
showed callbacks bypassed by direct copyFile/rename. Ordinary distinct transfers
passed; callback error/unknown/cancel still allowed replacement, and MOVE removed
source. Four alias operations reached LOCK and transfer but Apache itself rejected
with EACCES: those bytes/names survived; do not call that observed corruption.
The separate minimal regression is 2/23 pass, 21/23 fail before the fix, 23/23
after. See `DIRECT-RULE.md` and `evidence/direct-before-fix`.

The narrow guard uses existing comparison negotiation for explicit configured
authority or a public override before existing-target replacement. It preserves
error/abort reason/override/known-identity precedence; same rejects EINVAL and
explicit unknown ENOTSUP. Same-path no-op cannot bypass errors or a conflicting
distinct answer. Bare native operations and absent-target creation retain their
protocol guards. No identity invention, lease/cache, contract or new public API.

## Matrices (pass/fail, never pooled)

Original cohorts remain byte-identical, including all failures and oracle defects.
`consumer` is the unchanged original public matrix; `direct` is the new 17-row
public destructive-entrypoint matrix. Refusal passes are not positive support.

| Cohort / surface | Positive P/F | Guard P/F | Refusal P/F |
| --- | ---: | ---: | ---: |
| Original Apache final / raw | 9/0 | 7/0 | 0/0 |
| Original Apache final / consumer | 14/3 | 14/0 | 2/0 |
| Original WsgiDAV final / raw | 3/6 | 3/4 | 0/0 |
| Original WsgiDAV final / consumer | 10/5 | 13/0 | 4/0 |
| Legacy Apache before authority / raw | 9/0 | 7/0 | 0/0 |
| Legacy Apache before authority / consumer | 16/1 | 14/0 | 2/0 |
| Legacy Apache before authority / direct | 2/0 | 3/12 | 0/0 |
| **Legacy Apache final / raw** | **9/0** | **7/0** | **0/0** |
| **Legacy Apache final / consumer** | **16/1** | **14/0** | **2/0** |
| **Legacy Apache final / direct** | **2/0** | **15/0** | **0/0** |
| **Legacy WsgiDAV final / raw** | **3/6** | **3/4** | **0/0** |
| **Legacy WsgiDAV final / consumer** | **10/5** | **13/0** | **4/0** |
| **Legacy WsgiDAV final / direct** | **0/2** | **13/2** | **0/0** |

Intermediate `legacy-apache-after-authority` and
`legacy-wsgidav-after-authority` have the same respective counts as the final
cohorts. They are preserved separately. The final harness adds observations, not
changed assertions: lockdiscovery **before** native UNLOCK and after every new
public row, even failed assertions. All raw rows retain status, both GET byte/
absence observations, lockdiscovery and task-root-only host witnesses on failure.
Original early WsgiDAV rows that stopped before effects remain incomplete; later
cohorts do not retroactively fill them. All input copies/hashes are retained.

### Apache configured support and remaining failure

Both default existing-target public COPY and MOVE now actually replace bytes;
MOVE removes source, UNLOCK is 204. Native wire pre-UNLOCK discovery still reports
the lock; post-UNLOCK discovery is empty. This is distinct from opt-in ETag support,
which also remains measured, not a default-policy workaround.

Truthful native backing comparison rejects direct hardlink and followed-symlink
aliases before LOCK/transfer, preserving bytes and names. Error, unknown, abort,
lexical self and competing-client lock controls pass. A lock acquired through
/dav blocks an un-tokened /alias PUT with 423 and preserved bytes in this profile.
Late real acquisition cancellation produces no transfer and UNLOCK 204.

The original directory-timestamp positive still fails EAGAIN: creating Apache's
metadata store changes the directory validator and requested virtual timestamps
are not retained for the new representation. `4143efd` truthfully detects this;
there is no fake success or retry. A separate already-initialized update works.
This remains an interoperability gap, not a refusal reclassification.

### WsgiDAV is not a safe overwrite profile

Both specifications require coded-URL Lock-Token framing and quoted entity-tags.
This pinned provider's bare token header and unquoted DAV:getetag remain invalid;
real GET strong tags are separately observed, never fabricated from DAV metadata.
Public lock positives fail EIO before COPY/MOVE and leave a server grant active;
the untrustworthy header cannot be used by the adapter for cleanup. Final witnesses
show unchanged source/target bytes and the remaining lock. Late cancellation also
leaves that grant active: a failed guard, not cleanup success. The owned server is
then stopped and its whole owned lock store/root removed.

Native probes using valid observed strong GET validators independently show
ordinary existing-target COPY/MOVE source If-Match incorrectly yields 412, while
stale destination tagged If permits destructive 204. Those guards were exercised;
the invalid DAV:getetag row itself is only a format failure, not a conditional test.
Wrong destination lock token is 423 here, not the asserted 412; old Apache 400
oracle mistakes and weak-GET corrections remain in their original cohorts.

Native token-bearing COPY/MOVE replaces the target but pre-UNLOCK discovery is
already empty and UNLOCK returns 409, confirming actual lock loss in this run.
The new raw alias control accepts a /alias PUT with 204 despite the /dav lock and
changes target bytes: a further provider/profile guard failure. Direct truthful
alias/error/unknown/cancel controls do pass before provider mutation, but do not
repair these provider protocol behaviors. No source guard, response header, ETag
strength, default policy, or transport credential restriction is weakened.

## Frozen validation and public consumer

`legacy-final-source-validation` validates committed source only: 23 legacy LOCK,
5 timestamp, 23 direct-authority, 564 existing WebDAV and separately 14 constructor
tests pass; all 49 historical mount/overlay alias fixtures pass. Strict scoped
types and isolated ESM/declaration build pass. `legacy-original560-final` repeats
against the requested historical tree with only owned source overlays. Its 564
are the original 560 unchanged tests plus four reflection-generated decorator
cases for the newly added private method; no fixture text changed or test dropped.
The earlier legacy-only run was exactly 560/560. These are not all-repository gates.

The 49 fixtures and helper are copied byte-for-byte into the owned snapshot and
checked against both current files and `eab1d48a90456c1c2cdeb9289b32f1ed62429137`.
The Dirac historical writing runner was not run in-place or modified.

`example.mts` is the complete executable typed public example; `https.mts` is its
Node builtin HTTPS transport with per-request CA, bounded byte streaming,
backpressure and abort support. `run.mjs` supplies actual literal JSON config,
strictly compiles it with the consumers, then runs ordinary Node against an
independently named consumer package's extracted tarball. Imports resolve into
`consumer/node_modules/virtual-bash/dist/index.js` and
`consumer/node_modules/virtual-bash/dist/fs/webdav/index.js`; exact absolute URLs
are in each final `phase2-consumer.json` and `PHASE2-CHECKPOINT.json`.
There is no source fallback, private Mock/resource helper or undefined resolver.

The backing resolver registers only actual configured clients and the known
task-owned RealFileSystem root with its shared native identity scope. Unknown
arbitrary Real/WebDAV relationships stay unknown. The original public matrix
also passes real Shell UTF8/binary pipelines, existing cross-view copies and MOVE,
basic CRUD, collection MOVE, names/listing/budgets, metadata, auth errors, streaming
and cancellation controls as individually recorded; do not infer unlisted support.

## Exact artifacts and reproducibility

Final source archive SHA256:
`adb3288582b457c01063d9f3eafcf658dcbf83156199c81774595ba5c3daaaaf`.
Final `webdav.ts` SHA256:
`8c280010a9de5f915ebb72be504d79f2a149e95064752c3a4b4a07cd425efd54`.
Identical packed tarball SHA256 on both final providers:
`7902ad280ae5c9ca776e9fa89002991810be9c0e879490c8b023a6bf24f4ae73`.

Apache binary SHA256:
`17eab33df66fd97b9a176505d3b4d3357fd529820a7bab1d460a2092344b0871`.
Final Apache profile JSON SHA256:
`7891a71f98fc1eb800755d61b80347cf0940f28b58de896a0be4f9dbc23f98ba`.
All module hashes and literal config are in `legacy-apache-final/apache-profile.json`.
WsgiDAV profile `server.py` SHA256:
`16188c6e6c8c24ae8c9dda1ee51a27003b116fd126d85e653bad09171bab1e35`.
Full official-PyPI eleven-wheel lock SHA256:
`e80ca4a6c021a346ee88dfe6098f7b87d1fddae72fe470292e24931fd24752a9`.
It pins WsgiDAV 4.3.5 and cheroot 11.1.2 with every transitive artifact/hash.
Bootstrap pip wheel, Python/OpenSSL versions and pip check are in commands.json.

Reproduce from this checkpoint on the documented macOS arm64 prerequisites,
using fresh cohort labels (existing labels refuse overwrite):

```sh
node tests/fs/webdav/real-service/phase2-seal.mjs --check
node tests/fs/webdav/real-service/phase2-validate.mjs replay-types --source=93c009df1d3de38207d0000b451839f29fa898f6 --aliases --committed-only
node tests/fs/webdav/real-service/run.mjs replay-apache apache --source=93c009df1d3de38207d0000b451839f29fa898f6 --legacy
node tests/fs/webdav/real-service/run.mjs replay-wsgi wsgidav --source=93c009df1d3de38207d0000b451839f29fa898f6 --legacy
```

Service matrix commands deliberately exit 2 while the recorded positive/guard
failures remain; this is not a green all-provider gate. Reproduction adds evidence
and thus invalidates the whole-subtree seal until a separate new seal is made.
The old CHECKPOINT/SHA256SUMS are preserved historical artifacts; use the phase-two
seal for this larger tree. It verifies every earlier sealed cohort byte unchanged.

## Residual assumptions and cleanup

Comparison is not a lease, transaction or ABA defense. A wrapper and direct
backend may negotiate independently; each negotiation queries each authority once,
and no unsafe cross-layer cache is added. If root requires one callback for an
entire composed operation, that shared-contract issue needs separate design.
Neither source fix proves arbitrary physical alias or provider lock isolation.
Configured FollowSymLinks is a declared test profile, not a host security sandbox;
all test symlinks and witnesses stay inside the task-owned server root.

Atomic rename remains false. rmdir remains ENOTSUP without recursive fallback;
chmod remains unsupported and modes advisory. No standard DAV pagination is
invented. No implicit GET validator fallback, metadata retry, permission API,
runtime dependency or global TLS/dispatcher/environment change is added.
All services bind numeric loopback with synthetic credentials and task-local SSL
config. Server children are bounded to 180 seconds, commands to 120 seconds;
finally stops children and removes only each owned workspace (root, HOME, venv,
downloads, key/config/lockdb) after recording evidence. Final cleanup files record
Apache normal exit and WsgiDAV SIGTERM; the seal verifies every owned workspace
absent. No external WebDAV writes, private credentials, global installation or
existing server service/configuration was used.
