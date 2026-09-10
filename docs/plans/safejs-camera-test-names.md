# Preserve camera test identities

Vitest object-placeholder formatting truncated all full camera case IDs into
the same label, including in JSON reports. A full batch-ID selector therefore
ran zero tests. The isolated tuple/string-placeholder correction makes all
11 names unique and selects exactly the requested batch (1d4933, 4b87bf).

The main test-only correction preserves all three native cases, eight sandbox
batches, full trace/native assertions, source, seed, budgets and timeout. Native
controls and JSON identity inspection qualify the name formatting separately
from runtime performance. Sandbox timeout failures are not repaired by naming.

Keep this its own test commit. The separately measured runtime allocation
candidate and its remaining qualification are documented in
safejs-camera-symbol-allocation.md. No push or release during the hold.

Main naming-only verification passed all three native controls (df3931), and its
JSON contains all 11 unique names (488d5e). The subsequent main focused integration
also passed the entire 11-test camera file (175520), with full trace assertions.
Its unrelated completed-replay failures are tracked separately; no all-green
package claim follows from this naming repair.

Main scoped ESLint passed (2ff34e). No timeout or resource limit was changed.
