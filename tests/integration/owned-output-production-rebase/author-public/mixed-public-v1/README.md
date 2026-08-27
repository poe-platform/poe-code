# Four built/moved public curl+cat integration cases

These are exactly four selected mock-transport test bodies from candidate
`eba049535d154f4e028f57ffd8efd7622b2239ca`'s committed author network fixture:
borrowed stdin streaming followed by cat, required body-file/stderr under stdout
closure, required header-file/stderr under stdout closure, and reused download
bytes across both curl-to-cat and file output. `PROVENANCE.json` binds each exact
selected body and the committed helper. No assertion is changed. Native transport
or service tests and the rest of the source owner's focused gate are not selected.

Import bindings change to the supported root/contracts/network package exports.
The helper registers the public `createStandardCommands()` family's `cat` only,
instead of the internal stream family. This explicitly changes the helper's
registration set, not the selected cat implementation or the selected assertions;
it is not represented as unchanged all-input proof. Curl remains explicitly
registered with each test's mock transport, never an implicit network capability.

The runner copies the exact previously built package into a new regular staging
consumer and physically moves it. It compiles only these public consumer files
using the already pinned compiler, then runs the four cases once under a bounded
Node test process. No product rebuild, package installation, native service,
private query, source fallback or test waiver is performed. All output and
before/after package/consumer/compiler inventories stay in unique regular TMP.
