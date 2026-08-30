# Candidate-only postprocessing correction

The original frozen candidate runner in `4d524fd8` ran all 18 unchanged prepared-v2
cases once. All 18 children returned successful JSON and exited naturally. Its
postprocessing then failed before writing a seal: manifest paths were made relative
to logical `/tmp/...`, while Node's loader reported physical `/private/tmp/...`
URLs on this host. The first loaded hash therefore looked up a nonexistent relative
manifest key. This was not a product failure or a changed loaded module.

`runs/candidate-01/replay-error.json`, the frozen runner, execution binding, all raw
outputs and original case assertions are preserved. `candidate-seal.mjs` performs
postprocessing only; it has no consumer execution loop. It resolves the already
existing package root with `realpathSync` before manifest lookup, additionally
requires the exact physical public package prefix/entry, and retains exact hash
equality against the frozen 709-file packed inventory. All prior source/tool,
worker, child, resource, fixture and baseline-transition checks remain required.

No case is rerun, added, removed, rewritten or given a weaker expectation. The
recovery also hashes retained evidence before/after sealing and removes only the
exact authorized candidate scratch directory after validation. Historical baseline
preparation defects and failures remain independent and unchanged.
