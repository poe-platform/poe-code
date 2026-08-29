# Generated-package admission ordering: source/data adjudication

2026-08-29. No build, compiler, product, Worker, native oracle, install, inflation, or historical helper execution in this diagnosis. No product/harness edits. The744 literal results, startup failure, publication-lock failure and all previous qualifications remain unchanged. ROOT acceptance remains held.

## Finding and policy classification

**The granted exact type/size/expected-hash-before-decompression order was not implemented.** The runner computed the compressed hash, inflated and parsed the package, then compared the known expected hash. A compliant executor should have blocked at the missing admission boundary before inflation; I should not have treated the existing runner as satisfying that prerequisite. Later equality cannot retroactively supply the required ordering.

The recorded run did not exhibit an actual hash mismatch, capture loss, permission violation, deadline, or unknown retirement. This is a bounded but real admission-order noncompliance, not evidence that unauthenticated product JavaScript executed. Native zlib processed bytes not yet admitted against the expected identity, and an in-memory tar parser inspected them. That processing is itself the operation the required gate was supposed to precede; it must not be described as “nothing happened before admission.” No automatic retry or policy waiver follows. ROOT decides whether crossing that gate consumes the attempt under its STOP policy and what evidence it will qualify; the original run cannot be labelled fully compliant either way.

## Exact artifact and producer

Path:

`/private/tmp/strict-n14-independent-active-1AKd2V/strict-extension-independent-iRrorS/virtual-bash-0.0.0.tgz`

It was produced inside the fresh owned work root by recorded child offline-pack PID83488, after production-build-once PID82941. Command: pinned Node22.22.2 executing copied npm10.9.7 `bin/npm-cli.js pack --offline --ignore-scripts --json --pack-destination <work>`, cwd `<work>/source`. Build command: the same Node executing copied TypeScript5.9.3 `bin/tsc -p <source>/tsconfig.build.json`.

Inputs were the authenticated293-member selected graph bf079ada185a79aec864b068f3738ddc5520822e, source manifest12a5806df9ea13eb66e99bec1f0c0c3198bfeb76da012559d943a4d874070fc4. Only runtime changed from the preceding selected source. At run-v2.mjs:134, each Git blob header/length, SHA256 and Git object hash was checked before writing its source file. At :145, original tool inventory hashes were matched to SOURCE.toolBindings; regular files were lstat/type/size/mode/hash checked before copying. Node's executable identity was checked at :19 and for child execution. Tool inventory digests are retained in BINDING-PROOF.json, not newly inferred from version strings.

The expected package SHA256 **3f3ae85116f12ab4354a6103c0c95e967c4e88bd2eb133e63236148a2734af49** was already available in the committed PRESEAL, before execution. It was not learned from the artifact being tested. Actual compressed length872281 and npm-reported unpacked payload4821648 are recorded in the raw pack output. The current retained file remains regular and has that exact SHA256; this source/data read is a post-observation, not a retroactive pre-read type check.

## Actual order and bounds

All line references below are to the frozen `../run-v2.mjs`, SHA256 **27513d8c4c158999c42508fe797831280657e50f2f96eacd345871eb1d71dfac**.

1. `child()` closes the pack process and runs `scratchBytes()` before returning (:26, :39). That general walk performs lstat throughout the owned root, rejects symlinks and enforces aggregate scratch <=1,006,632,960bytes. It does **not** specifically require the archive to be a regular file, compare its size to872281, or bind an opened descriptor against replacement. Thus “no pre-read lstat anywhere” would be inaccurate, but this is not exact archive admission.
2. At :173, npm stdout is JSON-parsed, basename equality checked, and the archive is read with `fs.readFile` into one whole compressed Buffer. No archive-specific compressed-byte ceiling or exact-length assertion precedes that read. The prior scratch audit is only a non-atomic aggregate bound, not a racing-writer/read-allocation guarantee.
3. At :174, `archive.length` and SHA256 are recorded. The expected hash is **not compared here**.
4. At :175, `gunzipSync(archive,{maxOutputLength:67108864})` produces a whole decoded tar Buffer. Compressed and decoded buffers coexist. This is not streaming inflation, a total-RSS bound, or a claim about every native transient allocation.
5. At :176–182, the tar is parsed in memory. Names must start with package/, no parent or AGENTS components, only regular-file headers, valid bounds/checksum, unique paths and zero trailing bytes. Each member's content hash is computed. No member is extracted to disk by this parser. Receipt members/padding imply5,545,984 tar bytes, agreeing with the retained gzip ISIZE trailer; this is a data derivation, not fresh decompression or an independently logged decoded-length measurement.
6. Only at :183 is the expected compressed SHA256 compared, followed by954-member count and empty product-runtime-dependency checks.

Both compressed/decoded Buffers were whole-buffered. The8MiB child-capture ceiling bounds npm's JSON stdout/stderr, **not** the generated tarball. The64MiB decoded cap is explicit; an exact compressed input gate was absent. No inherited base64/gzip DATA archive was decoded at all, so the exceptional5,916,905-byte/6MiB admission rule was unused.

## Authentication before product execution

After the expected compressed hash matched, at :184–185 every shipping member was compared to the corresponding built source-tree file. At :190 the first product consumer was launched. Source-built means compiled JavaScript from that authenticated build, not raw TypeScript execution. BINDING-PROOF.json independently checks that the captured initial source, installed and moved consumer bindings contain exactly the952 dist members of the authenticated954-member package, with matching bytes/modes/hashes. This is an actual-data membership check, not a claim that the source-tree preflight had an independent extra-member-rejection assertion.

At :192, only after package identity admission and source-layout testing, scripts-disabled offline npm install performed physical extraction. At :193, its complete954-member inventory, modes, lengths and hashes were compared before installed consumers. At :195 the installed parent was physically renamed for moved testing; per-consumer inventories/load checks and final package postguards bound that retained tree. No archive member extraction occurred before the expected-hash comparison. Mutant files are separate, explicitly authorized modifications with loaded-hash checks and semantic restores, not unreported shipping-byte differences.

The frozen successor-bindings-v2/loader.mjs:11 checks every file module's regular type, non-symlink/canonical path and8MiB ceiling; :16 compares its hash; only :19 returns the exact read bytes as module source for evaluation. Builtins use the pinned Node host. Harness/loader/bootstrap bytes were authenticated and copied before launch, not self-authenticated by a hook that would already be executing. This is a specified product-module binding guarantee, not complete arbitrary host-module tracing or hostile-host race security.

## Earlier side effects and script qualification

Before package identity admission, authenticated development Git read blobs, TypeScript parsed source and wrote compiled/declaration output, npm read metadata, packed/compressed and wrote the tarball/cache/output, and the coordinator parsed JSON, inflated with native zlib, hashed and parsed tar headers. Those tool/data operations are distinct from executing packaged product modules. No native tar/gzip executable was requested by the runner; this is not a complete descendant-execution attestation.

The exact package.json has no prepack/postpack/prepare/install lifecycle scripts. Source-verified libnpmpack gates prepack/postpack on !ignoreScripts. Pacote's directory preparation has its own prepare branch: the inspected source must not be generalized into a claim that this flag alone blocks every possible prepare route. Here the authenticated manifest has **no prepare script**, so that branch cannot dispatch a package prepare command. No npm test or product script execution occurred in this diagnosis or in the pack role. Explicit TypeScript compilation is an authorized development-tool execution, not a package lifecycle script.

## Smallest prospective correction and proof

Not implemented or executed here:

- Bind the artifact's exact expected length872281 and SHA256 before decoding. Open the owned path without following symlinks, fstat a regular file, enforce the input limit before allocation/read, read boundedly and verify the exact length/hash. Inflate the same verified Buffer, not a second pathname read. Keep the existing decoded/aggregate/output ceilings. Preserve actual close/error precedence; do not claim race-proof security solely from lstat.
- Preseal a bounded negative control using the actual admission entrypoint and an observable decoder seam: same-length byte tamper, short/oversize input, symlink/nonregular file and wrong expected hash must refuse with **zero decoder invocations, zero tar parsing and zero extraction/product launches**. A positive authenticated retained artifact establishes one downstream call with the same admitted bytes. Controls must prove the shipping caller uses this gate, not merely an unused helper. All proposed controls are UNRUN.
- An admission-only replay against the retained, already hash-bound872281-byte artifact can establish the repaired ordering without a compiler/build/install or product execution. No fresh product run is technically necessary to determine which exact bytes produced the existing N14/744 outcomes: later hash equality, pre-import binding, raw captures and load traces already establish that. This would **not** convert the old run into a fully compliant run. If ROOT requires an end-to-end campaign that enforced the precondition at the time, a new explicitly authorized campaign is necessary; no such GO is inferred.

Recommendation: retain the744 observations as byte-bound semantic evidence with this explicit noncompliance, keep acceptance held for ROOT's policy adjudication, and request only the narrowly sealed admission guard/negative-control proof if ROOT considers it sufficient. Do not silently downgrade the original requirement, rerun product tests, or call the earlier order compliant.
