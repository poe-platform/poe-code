# Retained chronology baseline

August28,2026. Precode17f3760c, executor29d7aa75. The six actually evaluated
framework module bodies are byte-identical to de9dae6d; the new executor and
updated admission seal do not contain a chronology fix.

Three preselected whole-driver synthetic controls: **1/3 pass**. T01 natural
completion passes. T03 exit+close1ms/spawn2ms/group-absent3ms incorrectly succeeds
at25ms; T04 exit1ms/spawn2ms/close+absent3ms incorrectly succeeds at3ms. Each bad
case also admits a second modeled row. These are adversarial injected callbacks,
not actual Node event observations. No real observer child/native recipe ran.

Raw capture `captures/chronology-v4-baseline-1787928076193-12827.json.gz.base64`:
- Encoded SHA256 `12f0864540f563188de1f541c22edee68205f48c9841c90c5a16e5a5516def04`.
- Decoded SHA256 `25724706cb8f75927c6ae8ddf7a7450a2ddfebafb43d592fcf5fea9e62cbde6b`.
- Baseline seal `22e485b482d28f35a2d6e03145e75e36175635503592c243b4ddfb2dee82c403`.

Parent command uses existing Node22.22.2 with --experimental-vm-modules. Its
standard ExperimentalWarning was emitted; interpreter exit1 reflects the two
failed predicates. Model queues/descriptors drained; no OS resource was acquired
by injected primitives. Six whole module loads and all eight bound sources are
recorded. This does not rescore Locke's47/49 or the preserved30/31+17/18 history.
