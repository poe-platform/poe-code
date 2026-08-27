# Candidate A — discovery profile split

Root approved proposal `ab02ed86ad637e2319a7734cc53904d41eed97d1` after independent
pre-edit freeze `a48b1e9dc8bcada35d1818ee569c3e74d90b9980`. No review controls were
read. Original eleven preparation files remain byte-identical.

The canonical discovery file now selects the complete pinned `GNU-5.3` profile:
all52 logical discovery inputs plus all8 unchanged host/safety tests. Its exact
tuple assertion and filesystem-operation guards are unchanged. The new selector
checks native-file SHA256, fixture SHA256, both binary identities, profile names
and full ordered source/mode/name inventories; no native binary is needed to run
canonical tests.

The original historical comparison body is separately executable, still strict:

```
node --import tsx --test tests/shell-stress/canonical-profile-migration/historical-discovery.ts
```

It is intentionally not named `*.test.ts`: root explicitly approved separating
historical52 from the current-profile canonical denominator, not marking those
losses passed/skipped. Current53 source still disagrees with16 historical rows.

## Recorded attempts

- `candidate-A.json`: initial instrumentation startup failure, before any test
  module imported. TAP reports one failed file wrapper, not60 executed cases.
  A newline in the data-URL loader was incorrectly escaped. Zero actual loads;
  its raw `guard.valid:true` is vacuous and is **not provenance acceptance**.
  The artifact is preserved unchanged.
- Corrected only the owned loader to use a raw template, then performed a
  standalone loader smoke check (no product/test imports). The runner now also
  requires nonzero actual loads. No assertion/product source changed for repair.
- `candidate-A-execution.json`: first actual cohort execution, **60/60 current**
  and **36/52 historical,16 failed,exit1**, zero skip/cancel/TODO.50 actual module
  loads match archive hashes; zero input/import/product-blob drift. The failed
  historical run is not counted as green.

Both actual runs used a fresh complete committed6e source archive (all173 source
files, package/lock and both tsconfigs), frozen original helper/native inputs and
the updated test/selector. Only existing devtools were linked. Tracing forwards
the owned trace preload to Node children; it does not wrap Shell.exec, transform
scripts/argv, change virtual environment, or force a different product index.
No current live-source/global acceptance or source edit is claimed. Scoped
typing is deferred to the final authorized roots check. All child parents ended.
