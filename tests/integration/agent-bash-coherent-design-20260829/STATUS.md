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
