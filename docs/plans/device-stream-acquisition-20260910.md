# Close canceled device-stream acquisition before reading

The independent pr review reproduced eight failures when a backing filesystem's
`readStream` or async-iterator acquisition synchronously canceled the invocation
with `false`, `0`, empty string or `null`. The DeviceFileSystem wrapper still
called the acquired iterator's `next` once. Preserve the original evidence in
`/tmp/issue680-pr-independent-red-v6.log`.

`deviceReadStream` awaits acquisition and then unconditionally calls `next`.
Pass the supplied borrowed signal through this wrapper and verify cancellation
after acquiring ownership but before beginning the read. Still close and drain
the acquired iterator exactly once; do not lose resources by checking before
ownership is retained. Preserve lazy acquisition, close behavior, existing error
selection and the absence of implicit host filesystem access.

Add generic DeviceFileSystem tests without a pr dependency, first reproducing
the failing acquisition cases. Cover early cancellation, return/drain ordering,
falsey reasons and existing device semantics. Root refreshes the canonical
safe-fs core before actual-Shell retesting, runs maintained shared-scope gates,
and owns the distinct atomic commit and release. Do not mistake stale built
dependencies for a source-level failure or change pr to bypass DeviceFileSystem.

The frozen source fix reproduces 14 generic failures before the patch and passes
86 adjacent DeviceFileSystem tests afterward, plus strict scoped types. Logs are
`/tmp/issue680-devicefs-acquisition-red.log`,
`/tmp/issue680-devicefs-acquisition-green-v1.log` and
`/tmp/issue680-devicefs-types-v1.log`. The pr fixture worker's 24 file hashes
remain unchanged. Canonical built-core and final integrated gates remain pending.

Independent review then reproduced two method-getter admission failures against
current source, not stale built output. The final wrapper captures `next` once,
rechecks cancellation/closing after the getter and invokes it with its original
receiver. Six additional generic cases now cover this boundary: 20 generic plus
72 adjacent cases pass, and both independent getter probes pass. Evidence is
`/tmp/issue680-devicefs-getter-red-v1.log`,
`/tmp/issue680-devicefs-getter-green-v1.log` and
`/tmp/issue680-devicefs-independent-getter-green-v1.log`. Root lint also found
and the author corrected one `prefer-const` diagnostic in the new generic test.
No lint rule, lifecycle assertion or error identity was relaxed.
