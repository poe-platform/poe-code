# Memory trusted-binding test-policy alignment

## Scope and frozen baseline

This is a test-only expectation alignment authorized by the user after the trusted
binding rule. No production code, contract, independent test, or old evidence is
edited. Baseline source checkpoint: d82cca909ae3019e47f85a7eb57cf7f0a207220a.
Its complete Memory result remains **143/158 with 15 legacy-policy failures**.
The original full fixture and raw failures remain byte-for-byte in
../faithful-binding-20260827/, alongside the earlier corruption evidence.
All preexisting Memory evidence and untouched test hashes were verified against
before.json; prior artifacts.json was verified independently.

Memory source SHA-256 before and after:
2ece749f3f22be6a0da76dcd964feb9b1055e742a05c727c43f672e9bc7ec8b4.
Original comparison fixture SHA-256:
a5f25f3e6423d8e1961e4c456a31f5ae01a6b604dccedd3af42034ed8d208fae.

## Exact old/new case mapping

IDs are the frozen comparison.test.ts IDs in d82 after.json/after-owned.tap,
not renumbered current suite IDs. after.json records each exact new name/path.

| Old ID | Exact old name | Classification | New expectation/entrypoint |
| --- | --- | --- | --- |
| 8 | qualified s3 cannot bless altered or copied Memory observations | Valid faithful forwarder | Successful copy; copied-stat/wrong-path rejection retained |
| 10 | genuine s3 metadata with Memory-alias content mapping stays unknown to-remote | Invalid declared binding | Separate mixed-mapping characterization |
| 11 | genuine s3 metadata with Memory-alias content mapping stays unknown from-remote | Invalid declared binding | Separate mixed-mapping characterization |
| 19 | qualified webdav cannot bless altered or copied Memory observations | Valid faithful forwarder | Successful copy; copied-stat/wrong-path rejection retained |
| 21 | genuine webdav metadata with Memory-alias content mapping stays unknown to-remote | Invalid declared binding | Separate mixed-mapping characterization |
| 22 | genuine webdav metadata with Memory-alias content mapping stays unknown from-remote | Invalid declared binding | Separate mixed-mapping characterization |
| 30 | Memory subclass data overrides cannot certify an alias to memory | Invalid declared binding | Separate override/damage characterization |
| 31 | Memory instance data overrides cannot certify an alias to memory | Invalid declared binding | Separate override/damage characterization |
| 32 | Memory prototype-before-construction data overrides cannot certify an alias to memory | Invalid declared binding | Separate override/damage characterization |
| 33 | Memory subclass data overrides cannot certify an alias to s3 | Invalid declared binding | Separate override/damage characterization |
| 34 | Memory instance data overrides cannot certify an alias to s3 | Invalid declared binding | Separate override/damage characterization |
| 35 | Memory prototype-before-construction data overrides cannot certify an alias to s3 | Invalid declared binding | Separate override/damage characterization |
| 36 | Memory subclass data overrides cannot certify an alias to webdav | Invalid declared binding | Separate override/damage characterization |
| 37 | Memory instance data overrides cannot certify an alias to webdav | Invalid declared binding | Separate override/damage characterization |
| 38 | Memory prototype-before-construction data overrides cannot certify an alias to webdav | Invalid declared binding | Separate override/damage characterization |

**2 valid-forwarder obsolete assertions; 13 invalid-binding characterizations
(4 mixed remote metadata/content + 9 Memory operation overrides); 0 newly found
legitimate product failures.** The two compliant cases retain exact copied-stat
and wrong-path unknown checks and add exact successful-copy namespace checks.
All other compliant alias, late authority/error/cancellation and readonly checks
remain unchanged. There are no skips, TODOs, error swallowing, production fixes,
or original fixture/cohort input changes.

## Separate damage characterization

binding-violations.characterization.ts is an explicit node:test entrypoint, not
part of the default *.test.ts compliant suite. It preserves all 13 adversarial
fixture mappings and exercises both original copy and mv actions. This is
intentional classification, NOT a claim that corrupting content is safe or that
an invalid provider is compliant. Its 13 verified observations count as **zero
compliant passes**. Exact error/status, byte, namespace, and effect assertions
remain runnable; none merely accepts arbitrary errors.

The 9 overridden Memory mappings each report copy EIO after one source-corrupting
write (source [17,18,19], target [4,0,253]), then mv status 1/EIO after a second
write, retaining both names. These preserve the original corruption facts.
The 4 mixed mappings report distinct because their genuine metadata falsely
asserts a different content store. S3 to-remote truncates Memory to empty even
when copy succeeds; S3 from-remote reports EIO with empty Memory; WebDAV
from-remote succeeds with empty Memory; WebDAV to-remote retains the payload.
All perform one content call for copy and one more for mv. To-remote mv reports
EBUSY without unlink; from-remote mv is S3 EIO/status 1 and WebDAV status 0.
Exact stderr/bytes/names are asserted and raw results captured. This does not
prove protection from host callbacks that contradict their declared binding.

characterization-probe.ts.txt and characterization-probe.tap preserve the initial
observation run (10/13 assertions matched; three preliminary copy/mv outcome
expectations needed correction). Those were probe expectations for invalid
providers, not three newly discovered compliant product regressions. The final
entrypoint asserts the measured outcomes exactly, including source corruption.

## Validation and provenance

- Compliant Memory: **145/145**, exit 0 (158 original registrations minus 13
  separately classified violations; the 2 forwarder cases remain in this suite).
- Separate violations: **13/13 observations verified**, zero compliant passes.
- Unchanged original 4 + required 49 guards: **53/53**, exit 0.
- Strict Memory-scoped noEmit, including characterization entrypoint: exit 0.
- No skips, cancellations or TODOs in these cohorts.
- Runnable test diff whitespace check is clean. The raw initial TAP preserves
  six trailing-whitespace diagnostic lines; they are not normalized as evidence.

Source and fixture hashes at both boundaries, HEADs, and source worktree status
are in before.json/after.json. Changed preexisting paths during this run:
- tests/fs/memory/comparison.test.ts.
Only the listed Memory test was changed by this task; remote owners and other
workers may advance HEAD independently. Historical original31/38 and
qualified38/38 are preserved as separate cohorts, not rerun or closed here.
Original d82 evidence and all earlier original evidence remain unchanged.

## Reproduce separately

```sh
node --unhandled-rejections=strict --import tsx --test tests/fs/memory/*.test.ts
node --unhandled-rejections=strict --import tsx --test tests/fs/memory/binding-violations.characterization.ts
node --unhandled-rejections=strict --import tsx --test tests/fs/mount/copy-identity.test.ts tests/fs/mount/copy-identity-guards.test.ts tests/fs/overlay/copy-identity.test.ts
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/fs/memory/*.ts tests/fs/memory/*.ts
```
