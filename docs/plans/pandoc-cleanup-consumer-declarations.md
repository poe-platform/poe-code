# Pandoc declarations in cleanup consumer snapshots

The maintained test route reproduced missing private Pandoc metadata in the
isolated public cleanup consumer. After admitting metadata, a focused rerun
reproduced missing Pandoc declarations.

Capture bounded private workspace manifests and declaration bytes, verify lock
bindings and capture hashes, and stage them with the existing root inputs. The
existing verification loop checks both original and copied bytes for mutation.
Do not admit private runtime imports or relax worker cleanup assertions.

Validate all public cleanup scenarios, ESLint, and the maintained test route.
