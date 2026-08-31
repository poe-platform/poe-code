# Hosted Linux native diagnostic qualification

This explicit trusted-main workflow mode is diagnostic, not a release gate or
an alternate passing test profile. Default dispatch and push/main release behavior,
root dispatcher, concurrency, original configuration and deadlines stay unchanged.

`linux-native-diagnostic` checks out the resolved triggering SHA without persisted
credentials, uses Node22.22.2 and the unchanged lock, and runs only these two
original lint-fixture titles separately with V8 profiling:

- captures the actual metadata cap in inventory phase and clears a fresh initialization
- completes an owned mixed traversal under the authorized eight-million metadata cap

The per-test 30,000/20,000ms deadlines remain intact. A separate five-minute outer
process bound protects the diagnostic runner and is not test acceptance or a
timeout increase. No pool, concurrency, fixture, guard, memfs, permission, cache,
or assertion change is made. Keep failed assertions and worker profiles; selected
passes cannot replace the ordinary configured release gate. Prior actual hosted
64,385/55,871ms failures remain authoritative until a matched ordinary gate passes.

The job verifies the approved fixture and guard hashes before execution and seals
the same source/config/lock hashes afterward. It records only fixed Node/CPU/cgroup
and Git package observations, not environment dumps, credentials or arbitrary files.
The retained V8 profiles must contain actual test and guard worker frames; a
coordinator-only profile is insufficient. JSON assertion output and logs survive
even if the selected diagnostic fails.

Git observations include the actual executable/canonical path, regular-file mode,
size, digest, version, exec-path, package owner/version and available independently
signed Ubuntu archive metadata. A new observed executable digest is not admission.
If the installed Git has no matching authenticated distribution chain, report the
gap and propose a finite binding separately. Do not install or substitute Git.

The job has contents-read permission only, no publishing credentials or release
step, a 25-minute job bound and private HOME/cache/tmp. Retain evidence for 14 days,
at most 128 regular files/128MiB total/32MiB per file, with no symlinks or arbitrary
artifact roots. Download and seal the artifact promptly after the run.

Validate workflow changes with `npm run lint:workflows`, not workflow unit tests.
Before dispatch, use normal hooks and coordinate the exact push scope with ROOT.
Linux/GNU and Darwin/Apple semantic qualification remain separate requirements;
this diagnostic does not qualify either host lane or publish poe-code.
