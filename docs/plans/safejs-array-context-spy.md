# Array call-context regression instrumentation

The complete SafeJS candidate run has one failure: setter values and receivers
are correct, but the partial accessors module mock records no calls. The failure
reproduces in isolation after the new accessor/intrinsic dependency cycle.

Replace the import-time partial mock with a post-import spy and restore it in
finally. Keep the exact two-call, defined-context and shared-identity assertions.
Do not change runtime behavior to satisfy the spy.

Validation: the revised test passes. Temporarily reintroducing a fresh context
per write makes its identity assertion fail while the other assertions pass.
Restore context reuse: 33 tests pass across the spy, initial eval calls and
restricted arguments descriptors; focused lint passes. The same test is copied
byte-for-byte into the isolated candidate and passes there too. A fresh maintained
build and full suite have started; their result is not yet known.
