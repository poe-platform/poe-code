# Before-reconciliation input data

These `.ts.txt` files are byte-preserved historical input data, not compilable
TypeScript fixtures and not discoverable tests. `before.json` records the exact
before-HEAD, Git blobs, SHA-256 hashes, and original positive row/body boundaries.
The originals are changed only after this archive exists. Nothing in the old
stock 78/79 or configured 79/79 evidence is changed or relabeled. The configured
historical workload replay explicitly materializes these inputs in its isolated
consumer, typechecks them there, and reports a separate profile denominator.
