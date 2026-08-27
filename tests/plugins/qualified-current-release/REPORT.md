# Qualified current-release author result — August 27, 2026

**The mandatory qualified job exits1, not release-ready.** Its current WebDAV
consumer actually runs and exposes one unchanged failure. The gate retains that
failure despite passing archive, metadata, stream and packed-public phases.
No expected outcome, consumer/oracle input, production API, root cold config,
root export, package script/dependency or lockfile was changed by this author.

## Exact candidate and results

Actual outer command is retained in `evidence/current-outer.json`; it tested
commit `5456730f1307f8c7fd3e8fcad342dc2eb6db2c27`, from
2026-08-27T08:09:20.680Z to08:09:59.981Z. This is actual elapsed execution,
not a claim of72 hours or full-project validation.

| Mandatory phase | Result |
| --- | --- |
| Cold isolated build and historical selected-gnu strict build-first check | pass |
|22 maintained `.mts` inputs,13 strict public-declaration groups |13/13 compile; no source/shared-dist fallback |
|12 emitted runtime groups |11 pass,1 fails; two S3 modules are import-only, not service workflows |
|Unchanged S3 constructor consumer |6/6 |
|Unchanged WebDAV loopback consumer |12/13; one real mv-to-remote failure |
|Seven WebDAV provider/research inputs |strict compile only; not service passes |
|Current unchanged archive native files |11/11, zero skip/TODO/cancel/fail |
|Metadata/table under explicit member-group fixture TMPDIR |318/318; all22 required native rows |
|Current stream profile |18 node:test groups covering186 internal cases; strict124/164 native,40 exact stderr differences retained |
|Current registry / moved offline packed consumer |31/31 /21/21 |
|Strict packed public positive / seven negative type cases |pass / all seven rejected |
|Full mandatory outer job |exit1; current-consumer failure is not waived |

Source manifest SHA256:
`e7f64ecaa2cf5bce5fdebd3bfcca9e94d063d278b85ed9c263f742d104c32424`

Test manifest SHA256:
`d602edfbb0a07ae8b54bfa19980716eb13db8c294064d73cce1b9e8ec60dd1c8`

Harness manifest SHA256:
`1c0a4462bd7098e7f68088feba3bb1a34eb204f4b5865b064fe3df588aa1eb1c`

Git archive SHA256:
`dcc98e7c17b050756d9039a006ce895191055d2f10df1eee18c4a58e48af4320`

`evidence/current-result.json` retains individual source/test/harness/build
hashes, every command/output, current consumer inputs, native profiles and
package hashes. Both repeated offline packs have SHA256
`f3938f584cf5d1cb6e6cf7f0aea4814641f260b9624a090b10c642043871aab3`.
Source, original test bytes and rootdist remain unchanged. The staged index is
empty before/after this run. Product source differs from frozen independentb7:
regex cleanup registration `01aa1bff` and runtime ownership drain `4c16d9c5`
are included here. This does not close the five independently reported cleanup
blockers or retroactively change b7 evidence.

## Omitted consumer is not waived

`tests/fs/webdav/consumer/consumer.test.mts:38` fails the unchanged
`built public consumer: existing-target mv to-remote through actual serialized HTTP`:

```text
mv: EAGAIN: resource temporarily unavailable, utimes '/remote/target'
```

The current candidate's retained emitted fixture reproduces it with:

```sh
node --unhandled-rejections=strict \
  tests/plugins/qualified-current-release/.runs/qualified-doEgyQ/consumer/webdav-loopback/emitted/consumer.test.mjs
```

The original candidatef121 control also reports12/13 both with and without
the Node permission model. This is not cured by relaxing permission checks.
The read-only source/fixture inspection points to a fixture timestamp mismatch:
`src/fs/webdav/webdav.ts:981` verifies exact timestamps after PROPPATCH;
`tests/fs/webdav/consumer/provider.mts:58` omits the retained timestamp property
from PROPFIND and exposes second-rounded HTTP last-modified, while its
PROPPATCH handler changes backing timestamps. This is an identified lead, not
an authorized fixture correction or an assertion that the product is wrong.
Root has the exact path request for the provider owner. Neither file was edited.

## Inventory and preserved histories

At the tested candidate,156 tracked `.mts` paths are individually classified:
22 maintained current inputs;129 frozen WebDAV execution inputs; one frozen
time-env native-oracle consumer; four imported `.d.mts` declarations. The current
set includes the S3 rmdir consumer committed during initial inventory work.
The independently frozen time-env consumer is not a public package consumer:
its runner explicitly pinsd904ca9 and its README disclaims current/package-leaf
proof. Its eight product failures and Apple profile disagreement stay intact.
New standalone paths fail closed rather than disappearing behind an exclusion.

Dirac `aac345a0` remains accepted only for its bounded cold configuration:
canonical470/470+485/485, historical standalone omissions11/30, not all-TypeScript
inclusion. Current public programs are actually compiled/run by the new phase;
frozen and research artifacts are not retroactively called passes. Neither
historical/migration-negative fixture bytes nor the root cold config are edited.

The first exact966cfac outer attempt detected the concurrently committed
time-env consumer and failed before tests. Its full error is preserved in
`first-inventory-failure.json`. The firstf121 runtime launch incorrectly used
Node's `--test` orchestration inside a no-child-process permission profile:
absolute discovery failed, and relative discovery hit the child-process denial.
Both controls and the subsequent unchanged direct WebDAV failure are retained
in `first-runtime-discovery-failure.json`. The correction changes only the
owned runner to plain Node emission execution; it does not grant child-process
permission, change consumers, or rescore the original attempts.

## Native controls and authority

Final exact5456730 positive setup-only exits0 with zero tests. Unset explicit
tar argument (despite valid `GNU_TAR`), missing binary and wrong-hash binary
each exit78 with zero tests/steps. Raw outer commands and complete setup
summaries are retained in `current-*-outer.json` and `current-setup-controls.json`.
The six scoped prerequisite tests pass, including exclusive staging and symlink
parent rejection. Native pins are neither downloaded nor modified.

The positive archive phase runs both unchanged current files at their actual
hardcoded GNU1.35 path, not an environment-only substitute. Each current test
and helper hash also matches its historicale36 byte hash; source, build and
execution are nevertheless current5456730, not the historical runner. Both
cross-read directions and all unchanged controls execute,11/11 with zero skips.
Historicale3c04127 same-e36 missing5/6 and configured11/11 remain separate.

Measured native fixture profile: uid501, primarygid20, membergroup20,
parent/TMPDIRgid20, mode0700, umask0022; full groups and ACL output are retained.
Pinned GNU chmod probes establish0644→02755 and0644→06755 with exit0. No group
normalization was needed in this execution. The original author318/318,
independent first316/318, historicalSGID6 and strict124/164+40 differences are
not overwritten or explained away by this distinct controlled profile.

No full-suite, deployed-provider, lifecycle, release-ready, superiority or
72-hour completion claim follows. A different reviewer must check the new
combined committed candidate after this leaf closes.
