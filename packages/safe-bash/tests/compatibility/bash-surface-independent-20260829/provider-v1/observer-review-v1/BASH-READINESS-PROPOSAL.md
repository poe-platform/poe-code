# Proposed independent Bash3.2.57 builtin-only readiness — NOT activated

## Answer and limits

Yes, a separately presealed direct /bin/bash target could test the available reference image without first requiring the failed Node target to reach JavaScript. It still traverses sandbox-exec and macOS loader startup, so success/failure is unknown; the earlier dyld boundary may be shared. A trusted outer capture controller is separate from the fenced target and must not import a Node fixture in the target. This is an available-local-Bash readiness question, not GNU5.3 qualification, fencing proof for nine controls, forty semantics, or a product acceptance.

Existing root-reported metadata-only version observation: GNU Bash3.2.57(1), arm64-apple-darwin25 (Sagan822e82a70dfebc071d3b6e27bc78967afa40a993). No version probe is repeated. Pinned /bin/bash: regular0555,1293840bytes,SHA25635536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3. This phase authenticates the old tool declaration, not newly executing or rehashing the binary. The source-verified GNU5.3+patch015 acquisition is a different reference and is not substituted.

## Necessary fence distinction

Historical D03 profile6128bytes SHA256cd24747ce2db626904e4c6c3986e6a303a85dada923a9dc1e6e8496dee9a93a5 is Node-specific: only its Node pathname is in allow process-exec. Its read literals also include the Node/fixture paths, with fixed owned roots and two regular capture paths. provider-v1/profile.mjs:10–34 admits only prelisted harmless-Node cases. Do not pass a Bash request through that admission by impersonating a Node case, or call a modified profile byte-identical.

If ROOT means unchanged equivalent POLICY, recommend a separate request-binding profile: replace exact target executable/read/metadata identity with /bin/bash; remove unused Node/fixture allowances; rebind only owned cwd/home/tmp/capture literals to one new unused namespace. Keep deny-default, deny-network, deny-fork, no unlisted executable, the existing system/dependency/sysctl rules and capture access classes unchanged. No guessed extra library/read/Mach permission. Seal the complete resulting byte diff and separate tool/dependency provenance before a grant. No new profile is generated or applied here. If ROOT instead requires literally unchanged D03 bytes, reject this proposed launch at preparation: that profile does not authorize Bash exec.

## Proposed sole literal tuple for later preseal

Target /bin/bash; argv: [--noprofile,--norc,-c,"builtin printf '%s\n' 'BASH_BUILTIN_READY'",surface-readiness-3.2]. Expected literal stdout19bytes (BASH_BUILTIN_READY plus LF), stderr0, status0. This is an independently reasoned expected readiness tuple, not an observed native result. No imports, external utility, source/eval input, file operands, command substitution, pipeline, child command, shell redirection or job control. All shell syntax is a fixed reviewed literal; no untrusted strings enter it.

Fresh exact environment LC_ALL=C,LANG=C,TZ=UTC, owned HOME/TMPDIR and empty owned PATH; no inherited BASH_ENV, ENV, exported functions, SHELLOPTS or host values. Use one new fixture root, no private/repository read in the target. Preopened regular stdout/stderr files with exact literal permissions preserve the D03 capture transport; require descriptor/path identities, bounded readback and owner close, not streamed EOF claims. Stdin is the explicitly admitted empty input.

Proposed target sub-bounds: one intended sandbox-exec→Bash exec PID, one outer controller if required, peak2 excluding the existing coordinator; no intended target fork/Worker. Actual process/image transitions still require observation, not an inferred descendant census. Active3s +TERM2s/KILL1s only if newly granted, expected19bytes, per-stream64KiB logical sampled bound, ≤1MiB capture/16MiB work, cohort12s. Parent administrative/total-process limits must be newly granted and independently reconciled. These are not current reservations, hard post-kill guarantees or RSS bounds.

Bash-specific loaded dependencies are not authenticated by the existing Node linkage metadata. Keeping the system read literals unchanged is a proposed sufficiency test, not evidence that the list is complete for Bash; failure must not trigger a permission addition.

## Preconditions / decision

Fix and independently review the observer's capture/tri-state/source binding first; do not silently reuse an unqualified global process observer. Freeze exact profile/argv/env/namespace/controller/tool/dependency identities, no missing permission workaround, then request fresh explicit ONE-readiness GO. Stop on nonzero/signal/capture/identity/unknown retirement; no retry or auto-widening. A pass would establish only this Bash3.2.57 readiness tuple under that profile, not5.3 readiness or semantics. No activation is requested implicitly by this document.
