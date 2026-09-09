# Descriptor-backed array snapshot inspection

The full package run after array-realm preservation completed with 23,985 tests
passing, 31 failing, and 37 skipped across 925 files (601.91 seconds). The
preceding maintained build closure passed 23 builds and four fresh imports.
Source/test SHA256 remained
050bed3034f56f289aeee70e25914e3e61d30145c61ec0ad5fbc2e76f24d3226 before, during,
and after the run. The result includes existing uncommitted work and is not an
isolated committed candidate.

Twenty-two failures were snapshot-inspection assumptions: 15 randomness cases
expected inline arrays, and seven crash/resume cases did not recognize
guest-array heap nodes when selecting their crash checkpoint. A built-ESM dump
of const values=[3];return values confirmed a guest-array node with index and
length data descriptors plus its originating prototype reference. That state is
intentional and must not be removed to satisfy inline-array expectations.

Update the randomness assertion to check the serialized index and length
descriptors. Extend the existing crash-selector projection to read the dense
data arrays used by its scenarios; do not implement another runtime decoder or
change production serialization. Original resume comparisons, random sequence
checks, generator suspension checks, and operation-count expectations remain.

The two-file follow-up passes all 39 tests. Scoped ESLint and package TypeScript
also pass. This is not a rerun of the full package gate. Nine failures
from that gate remain outside this change: three retained-root accounting
cases, two legacy graph comparisons, one diagnostic-message expectation, the
string SDK input case, and two host-Promise import policy cases.

README refreshed with the actual full-gate result. No CLI presentation changes,
pushes, or releases.
