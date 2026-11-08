# Repaired source route review (SOURCEONLY until DATA receipt)

August 28, 2026. Exact repair commit d8cbb7d76459e14d20f57e19f7c01ce04fa08702.
All paths in this section are relative to the sibling path-transport-v2 unless
explicitly historical. Source bodies are inspected, not extracted/executed as
controller substitutes. RUNNER-SEAL authenticates their actual committed bytes.

## Complete historical-site disposition

| Frozen site | Repaired consumer and proof boundary |
| --- | --- |
| G01 | Old capture-metadata manifest `git show` is retired; METADATA and predecessor manifest/data files are exact sealed inputs. Fixed candidate/evidence commit bodies captured by freeze-inventory lines 12-15; D03 binds their OIDs. |
| G02 | freeze-inventory lines 10-11 uses ls-tree -rz --full-tree. readCapture -> parseTree at controller 233-236; H/P/R plus D03/D04 consume actual persisted bodies, not display strings. |
| G03 | Old selected-source whitespace parsing is not imported. sourceEntries remain unchanged frozen data; verifyProjection at controller 238 crosschecks raw full-census path/mode/OID. H001-H098 and M04-M08 exercise the actual function, with selected actual274 in D04. |
| G04 | Old unrecorded per-source git show is not replayed. Full selected object length/hash/OID is authenticated by batchObjects and controller 255-260; D04 consumes the actual historical object bodies transiently. |
| G05 | supervisor preserves stdout and now raw stderr Base64; only stderrBase64 return addition differs from original supervisor. child capture buffers raw Base64 at controller 136, recorder fragments at capture-io 23-28. No supervisor child dispatch in this review. |
| G06 | controller child writes ordered fragments plus aggregate digests at 134-146. No readCapture on fresh base child: parseTree directly consumes returned stdoutBase64. Persisted candidate route does use readCapture. C controls exercise persisted reader, not dynamic lifecycle/exit capture. |
| G07 | Strict first-TAB/NUL parser is path-bytes 15-35. Mode/type/OID domain, record ceiling, duplicate names, fatal UTF8, path components; treeHash rejects both file/directory conflict orders. H/P/R run actual functions. |
| G08 | Complete base/candidate treeHash precedes source projection, controller 231-238. D03 verifies all50002/98 and stored root; D04 verifies complete base and derived composition. No instruction pathname filtering of census. |
| G09 | Controller 239-241 constructs Set of base/candidate/selected OIDs, then joins only OIDs with LF. Pathnames do not enter requests. B12 is SOURCEONLY: builder is inline, not copied into a fake test target. B13 establishes inventory path/mode retention separately. |
| G10 | path-bytes 78-95 batchObjects binds exact request OID, type domain, decimal safe byte length, object hash, delimiter, complete consumption and uniqueness. B01-B11 and D04 execute real function. |
| G11 | Controller 244-247 asserts commit kind and tree header, after batchObjects exact OID authentication. D03 authenticates candidate/base/evidence captured commit body hashes; D04 uses requested OIDs for old actual batch. D02 unsupported-claim admission remains SOURCEONLY. |
| G12 | Controller 248-254 builds five overrides only after verifyProjection duplicate preflight; derives8437 over every base leaf, then candidate composition. D04 authenticates original override length/hash/OID data and reference tree; M08 tests duplicate selected override rejection. No stored lookup of derived roots. |
| G13 | Controller 257-262 limits selected mode100644, forbids AGENTS, checks selected object hash/size and parent OID before publication. verifyProjection additionally checks exact parent mode/path/OID; historical override authority remains exact sealed manifest. No materialization now. |
| G14 | Controller 310-317 reads fixed ASCII successor RUNTIME-SEAL path from explicit start.commit using git show, then compares body digest. Not a general path parser. Runtime barrier is source-only; no Git runtime-seal request executed. |
| F01 | Historical forensic capture script is never imported. capture-io readCapture authenticates ordered fragment files and both digests; C controls cover it. Extra orphan files are not rejected by helper; controller checkHarness separately enumerates sealed inventory-v1. |
| F02 | Historical display decoder is data provenance only, never imported by repaired runtime or reviewer. D03 uses raw capture plus frozen independent98/reference; batchObjects handles captured objects. |
| A01 | Historical admission capture script remains immutable; no invocation/import by successor or reviewer. Its results are authenticated data, not accepted general-path parser. |
| A02 | Same retired boundary for author manifest/case capture; candidate/evidence identity and sealed metadata are retained. |
| A03 | Historical gitTreeRecord regex is not reused. General raw census/projection is handled by path-bytes, while narrow selected source mode restriction is explicit. |
| A04 | Old line/name-only/trimmed metadata oracle is not imported. New development captures are raw and committed; no redispatch of historical admission script. |
| A05 | Historical matrix two-leaf controls stay immutable. D01 uses original synthetic expected tree with actual encoder. D02 has no dynamic stored-claim API and remains NOT_RUN. |

## Import closure and finite bindings

Runtime controller imports supervisor/deadline, path-bytes and capture-io plus
Node builtins; capture-io imports supervisor/deadline/path-bytes. Those modules
have no top-level spawn. Actual review imports only path-bytes and capture-io
(transitively supervisor/deadline). Author DATA driver and independent-tree are
source/manifest evidence, not the independent oracle or executed driver.

freeze-inventory is an explicit six-child historical metadata preparation route;
it creates inventory-v1, never dispatched here. freeze-seals only enumerates and
describes inputs; no old script import. Sealed metadata removes the old display
inventory but preserves baseManifest/sourceEntries, tools, matrix and preparation.
Controller checkHarness binds every file digest/mode and additionally exact
inventory-v1 entry names, so orphan metadata files are refused there. Its root
allowlist intentionally admits runs/report/output directories; no append-proof
claim is made for those directories or the entire repository. No new invocation
of checkHarness is credited to helper C18.

Strict UTF8 is explicit in EXECUTION-PROFILE and pathname: fatal decode plus exact
roundtrip, no replacement/normalization. All known98 fit this profile. P28 remains
unsupported arbitrary-byte coverage, not repaired general Git-byte parity.
Nonrecursive040000/tree is outside the -r leaf consumer, so P30 is unreachable.

## Future package/app/loader/childcapture interface: SOURCEONLY

Worker, loader, bootstrap, guard-control and deadline must be byte-identical to
actual-v1; RUNNER-SEAL binds both sides. Supervisor difference is raw stderrBase64
only. The controller diff removes lossy parser/tree/batch bodies, installs DATA
imports and OID requests, changes owned work/runtime-seal path, adds fresh GO,
raw stderr and inventory append guard. Future runtime/read-permission argv,
package assembly, sourceBuilds1/full882 package assertion, physically moved
consumer, app/worker/loader checks, jobs, bounds and mutation recipes are not
weakened. This statement is source comparison, NOT module-loader execution.

Future root needs an explicit new authorization tied to candidate and exact
EXECUTION-SEAL SHA256, attempt1. Controller reads ROOT-GO before creating work.
The unchanged 110-minute continuous clock, 70 planned children, serial ownership,
128MiB capture/512MiB work and individual timeouts remain future-only. Review
uses the narrower 15-minute/10-second metadata/30-second DATA grant instead.

Selected274 and authenticated compiler/config/tool closure determine future
emissions; no build is run and there are no known built-JS hashes. After future
build, BUILD-RECEIPT binds full emitted package and concrete app/loader/worker
copies; RUNTIME-SEAL must be committed before RUNTIME-START. Controller checks
build-receipt digest, package digest, worker digest and mutations digest against
that committed body; loader subsequently checks actual allowed module bytes,
modes, URLs and size at load. Parent directory/product/source before/after
inventories and permission arguments stay unchanged. This is derived future
binding, not a claim that those artifacts already exist or an actual future GO.

All original product SOURCEONLY concerns, historical25/68 nonexecution and
provider/module/consumer gaps remain inherited, not repaired or promoted by
this transport review. Author65 DATA is a separate claim, not the reviewer206.
