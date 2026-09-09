# Promise prototype Proxy adoption

Two native comparisons failed before the repair. After deleting the shared
Promise prototype's own then method and installing a Proxy ancestor, resolving
another Promise with an existing Promise skipped the inherited hook and read
error. The adoption fast path did not recognize this exotic lookup boundary.

Mark a Proxy boundary as custom then behavior in the fast-path predicate, using
the descriptor walk's existing callback. The normal thenable resolver performs
the guest read and preserves its result or rejection.

Four native comparisons cover a callable trap result, a thrown read error, a
revoked Proxy, and non-callable then identity. They use a separate native realm
and restore its Promise prototype immediately after resolving, before awaiting.
An initial revoked probe left the altered prototype installed while Node created
instrumented promises, causing async-hook errors; that probe was replaced rather
than counting instrumentation errors as runtime evidence. The corrected native
oracle has no uncaught errors, and all four cases pass after the repair.

A checkpoint case retains the Proxy across await before installing it in the
shared prototype chain. The broader Promise/checkpoint selection passed 706 tests
across 49 files. Scoped lint and package TypeScript passed.
Host-Promise property-import policy cases remain
unresolved and excluded from the focused selection; no full-package gate claimed.

README updated. No CLI presentation changes. Pushes and releases remain held.
