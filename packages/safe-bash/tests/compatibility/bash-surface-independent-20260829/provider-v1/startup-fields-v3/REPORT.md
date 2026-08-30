# D03 startup attribution v3 — bounded selected fields

## Result

One authorized read authenticated the same 6,779-byte record SHA256 4c9a28200253d2364fa094f6331efd37bb7a4fc02df49ae1a81e32962910c69e; no raw record was published. Eight presealed DATA controls pass separately; no target, native, provider, engine, Worker, Bash, or profile execution occurred.

The recorded faulting thread is index0. Its first eight frames all identify dyld image1, UUID 9f682dcf-340c-3bfa-bcdd-dd702f30313e, /usr/lib/dyld, arm64e: __abort_with_payload → abort_with_payload_wrapper_internal → abort_with_reason → ignition_halt → boot_boot → ignite → dyld4::CacheFinder::CacheFinder → dyld4::ProcessConfig::DyldCache::DyldCache. Exact offsets are retained in SELECTED-RESULT.json. This is an observed Node-process abort at a dyld ignition/cache-initialization boundary, not a sandbox-exec-image crash, JavaScript readiness witness, or complete thread/image census. The original privacy-redacted Node path remains redacted and does not authenticate the pinned executable's bytes.

Termination namespace remains <0x23>, code2; newly selected flags are582 (0x246). The termination indicator is absent. The application-specific asi field is absent, so this record supplies no additional diagnostic reason through that field. No other thread, register, environment, arbitrary user data, or unrelated record was retained.

## Primary-source qualification

[Apple xnu-12377.101.15 reason.h](https://raw.githubusercontent.com/apple-oss-distributions/xnu/xnu-12377.101.15/bsd/sys/reason.h) names namespace35 LIBIGNITION, distinct from SANDBOX25 and DYLD6. Under those definitions, 0x246 combines crash-report/userspace/consistent-failure/abort flags. The consistent-failure bit is a producer designation, not this phase proving repeatability. That header does not identify libignition code2; it is not interpreted as errno2, signal2, or a particular denied operation.

[Apple dyld-1376.6 DyldProcessConfig.cpp](https://raw.githubusercontent.com/apple-oss-distributions/dyld/dyld-1376.6/dyld/DyldProcessConfig.cpp), CacheFinder lines1050–1112 and DyldCache lines1204–1220, connects the two observed constructors to ignite. This corroborates the startup subsystem; it does not bind ignition_halt/boot_boot implementation or the recorded image UUID to that release source.

The earlier sealed provider TOOLS records Darwin25.4.0. Public versioned references are therefore kept as qualified comparison sources: no exact host kernel/dyld build-to-source authentication or meaning of libignition code2 is claimed. SOURCE-REFERENCES.json records consulted versions and limitations. Public repository/search absence is not proof source does not exist. No third-party anecdote is promoted to cause evidence.

## Cause and smallest next decision

**Permission cause remains UNKNOWN.** The evidence narrows the failure to the observed dyld ignition startup stack; it does not identify a missing library read, Mach service, path, operation, or needed fence allowance. Do not broaden the profile or retry a readiness launch on this evidence.

Smallest proposed future diagnostic, requiring a NEW root grant: read only an already-existing OS denial record matching historical PID17408 and its exact D03 event window, selecting operation/target/result and timestamp only after identity admission. Stop on absence, ambiguous identity, inaccessible data, or private-content limits. This is a proposal, not authorization or execution of unified-log acquisition. A new launch is not the next justified step. If no such bounded record can be authorized or recovered, keep code2/cause unknown and seek a version-matched official libignition definition rather than trying speculative capabilities.

## Scope, preservation, closure

Source preseal commit f0d67d5ebd6f50679f5075856ce99f159ccd7159; PRESEAL SHA256 362d4ce04c74bf1cbc82ab4091656c7090f462344d72241961c9742fdec624cd. Original receipt 46fc4ff0257d98409408dbf97681bf9a8a8a4615, all F01/D01/D02/D03 captures, and the earlier NO_EXACT_MATCH remain unchanged. This phase is an additional selected-field acquisition, not a rescore or successful fence qualification. Native9/40 remain UNRUN.

The reader closed its one record handle; selected capture closed before publication. No streamed EOF is asserted for file capture. The phase's explicitly launched administrative children are captured and retired; see PHASE-CLOSED.json and ADMIN-PREPUBLICATION.json for the observation boundary. This is not a universal descendant census, OS-wide memory bound, or RSS assertion. No target process or new fence variant was launched. Owned artifact namespace is startup-fields-v3 only; no foreign source is certified or modified.
