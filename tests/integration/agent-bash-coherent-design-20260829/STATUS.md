# Dependency HOLD amendment — 2026-08-29

ROOT relayed independent Unit4 evidence
`cd06468eb1a067d8324e1d0e873cccbc2ede14c2` after the first design commit
`4cc28cdb2538e2354c1d69fe167bd45214f337ee`. This is a received status update, not a
new reproduction or independent inspection by this design author.

- Unit4: **681/684**, comprising unchanged author **636 passing** and novel
  **45/48**. N14 is a real integration finding and the dependency is **HOLD**.
- Transparent `context.invoke` loses diagnostic-sink reason `0`, emits a second
  diagnostic, and registered-cleanup rejection `false` becomes public reason.
  Cleanup finished. The finding is **not proven introduced by 9bb91c37**.
- Exact boundary analysis and a separate minimal-repair grant are pending. No
  diagnosis, repair, expectation change, product execution or composition GO is
  inferred here. Proposed C17 must retain this cross-boundary adversary; it cannot
  assume the provisional Unit4 source already satisfies it.
- Unit3 remains ROOT-qualified accepted; public Node a6 remains accepted. The
  coherent combination remains unaccepted and unexecuted. The proposed tree
  `df748fb93484479a695928b6849d1df8fbfaee3c` still names the **held** original
  source, not a corrected candidate. No package exists for this combination.

Only dependency/status documentation and the DATA helper's status label change.
No selected source blob, fixture, shipping count, package API or old evidence is
modified. Future repair bytes require a fresh composition identity and preseal.

## Later author repair, independent acceptance pending

Source7196bace8ea2c141d5ed1020fef5bf721c321ace is an N14 runtime-only successor,
derivedbf079ada185a79aec864b068f3738ddc5520822e/full954 package
3f3ae85116f12ab4354a6103c0c95e967c4e88bd2eb133e63236148a2734af49.
Author versioned672/672 (636 retained+36 focused),6 type groups/24 negatives,
7 loaded mutants/restores and2 binding refusals pass; earlier bootstrap/staging
failures remain. Different Dirac follow-up is still required. See
tests/compatibility/bash-strict-extension-author-20260829/n14-v4/HANDOFF.md.

This does NOT replace this design's original9bb inputs/tree, accept Unit4's new
source, or authorize a combined build. Node a6 and Unit3 acceptance remain scoped;
coherent design/actual composition stays HOLD pending reviewed runtime selection.
