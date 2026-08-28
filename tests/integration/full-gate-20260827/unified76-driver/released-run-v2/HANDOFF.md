# One authorized scoped-route attempt — stopped in native setup, no retry

## Exact launch and terminal receipt

- Fresh authorization c222e17c4cbcc6bcb9da8a77414b90af3c465d88, receipt SHA256
  6c04ed4badd458d74f8d1c8c4dd945e55cdd087b90b7d49f097aa2338fae524d, binds
  packet52e83606, normalized6cc921ca044fed1b84546bb824f1ab7fc545119c7a5f8ecefd272b23dcd61195,
  scoped5bec6231/99684045 qualifications and metadatareview7ecfe453.
- Exactly one LAUNCH.md:80 command issued, tool session80997. The external
  receipt was sealed/committed before issuing it. This authorization is now
  consumed by root's one-shot policy, not a cryptographic token mechanism.
- Product f5e9fc49b6abb38e180cc9de16c95fced102ff75; driver
  2db94b8bf54405e5713b103bd677c873fcc0b153454b3deed13ee8ab4e90583e; profile
  8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f.
  Packagec109 remains expected, NOT rebuilt or tested here.
- Inner run11:01:53.330Z–11:02:47.868Z on August28,2026. Launcher exited1,
  HOLD_OR_QUALIFIED_RED. **0/14 phases,0 production builds, no canonical TAP
  counts, no package phase.** Internal fullGateLaunched:false means no phase
  cohort, not that no actual CLI attempt occurred. No SKIP/green inference.

## Concrete failure: native chmod, not another Git spawn error

The unchanged helper reached its mandatory native fixture-authority assertion at
combined-8670ebe8/prerequisites.mjs:40, through shipping execute.mjs:74.
It executed these two absolute native commands:

```text
/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/chmod 2755 <temporary>/native-tmp/authority-2755
/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/chmod 6755 <temporary>/native-tmp/authority-6755
```

Both report status1, signalnull, empty stdout, no spawn error, and exact stderr
ending `Operation not permitted\n`. Both files are uid501/gid20, before0644 and
after0644. The native-tmp directory initially had gid0 and was normalized by the
UNCHANGED helper to gid20;20 is in the captured user's groups. The helper's ACL
listing succeeded. This is not a nonmember-group assumption or a virtual command
assertion failure. Raw commands, paths, bytes, UID/GID/groups/umask and before/after
metadata are retained in native-fixture-authority.json and TERMINAL.json.

No independent syscall/policy trace identifies why the native permission change
was refused. Do not assert a particular sandbox rule/kernel cause from stderr
alone. No native probe repetition, permission widening, new route, fixture rewrite,
source repair or subsequent gate was performed.

## Routing, setup, private and cleanup boundaries

- Native51 identity admission had no issues; identity admission is NOT semantic
  success of the later mandatory authority probes.36 native executable copies
  were staged. Source authentication recorded37,397 logical/37,392 physical
  entries and2,382,440,321 logical bytes; exact six instruction paths remain absent.
- The prerequisite callback progressed beyond the two Git authority comparisons
  to the later native assertion. This is source/control-flow evidence, not a new
  per-call kernel trace. Its scoped adapter record retains the callback assertion,
  restored:true and poisoned:false. No drift/restoration failure is recorded.
  Original8e6b/df89 EPERM target remains UNKNOWN and that0/14 attempt unchanged.
- Opaque-history transport recorded452,180,499 bytes with no checkout; this is
  this run's Git transport artifact, not the npm tarball or prior pack byte count.
- SETUP-COMPLETE was never written. Private would-copy metadata admission
  occurred, but privateBefore/privateAfter, engine body copy and guest execution
  were NOT reached. No current private HEAD/status/index/pre-post guarantee is
  inferred. No private-state commands were issued during terminal capture.
- Worker67506 closed naturally, elapsed71,302ms, no forced signals or recorded
  survivors; outer observer's registered groups have no recorded survivors.
  Completed supervised phases0; aggregate fence/phase-protocol cleanliness is
  FALSE because expected phases/final sweep never ran. Natural worker closure
  is not full-gate cleanup completion or universal kernel/background drain.

All14 ordered outcomes are explicitly NOT_EXECUTED in TERMINAL.json:
safejs-availability, cold-typecheck, typecheck-all, benchmark-types,
env-source-binding, canonical, current-consumers, pack, public-runtime,
public-types, negative-types, missing-root, missing-contracts, final-sweep.
Expected negative exit statuses in those phases were not exercised.

## Immutable capture and retained roots

Eight original files totaling19,061,272 bytes are streamed to raw-v1/*.gz,
SHA256-indexed with decoded round-trip verification. Includes both inner JSON
receipts, all five outer receipts/streams and native authority JSON. Original
files/failed trees remain untouched. Two authority probe files have separate
content/mode/identity records; no full snapshot duplication or instruction-body
copy was made. Current shipping38 hashes and the six absent instruction paths
were checked, not a completed source/package/private final sweep.

- Output: /private/tmp/full-gate-unified76-f5-scopedenv-20260828-r2
- Outer: /private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/unified76-supervisor-lltDvB
- Owned work root: /private/tmp/unified76-os-write-HzSPPY
  (device16777232/inode181438673,mode0700,uid501).
- Temporary: /private/tmp/unified76-os-write-HzSPPY/tmp/unified76-execution-IO6zT7
- External receipt: /tmp/unified76-release-f5-scopedenv-20260828-r2.json

No active author session/worker remains. Foreign staging/processes and old
failed roots were not touched. No full test/build/typecheck outside the selected
attempt was launched. Root must authorize any independent diagnosis, correction
or new release; this failed attempt supplies no retry GO. E03.3 remains unsupported,
priorA10/protection/package proofs remain bound-only, and no current-feature or
XAN execution/acceptance is inferred.
