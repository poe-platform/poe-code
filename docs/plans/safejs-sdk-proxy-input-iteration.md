# SDK Proxy input and iterator acquisition

Five native-comparison SDK tests failed before changes: Proxy array-like inputs,
Proxy ancestors, Proxy iterables, Proxy-valued iterator factories, and Proxy
iterator objects. Results were silently empty or raised missing guest-context or
non-callable iterator errors.

Route the SDK input bridge through guest property access and retain that context
when invoking closures. Preserve supplied hooks and explicit newTarget.

Four initial tests then passed; the iterable Proxy still returned empty storage.
Iterator acquisition's descriptor-only absence check treated a Proxy boundary
as an absent method. Use the existing descriptor-walk boundary callback to defer
that decision to observable guest property lookup. Preserve legacy implicit
iterator behavior when no Proxy boundary is encountered.

Ten SDK tests now pass, including nested/accessor-backed traps, original receiver
identity, Proxy iterator results, and revoked inputs. Five additional native
comparisons cover spread, Array.from, synthetic iterator methods, async iteration,
and async-from-sync fallback.

The broader buffer, typed-array, iterator, generator, Array.from, Reflect, and
value selection passed 2,888 tests across 127 files. Scoped ESLint and package
TypeScript passed. The maintained selected-workspace build passed all 23 declared
builds and four fresh-process import checks. This is not a full-package gate.

README updated. No CLI presentation changes. No push or release while the release
hold remains active. Static TypedArray.from retains a separate SDK fallback
bridge and is the next candidate for native-backed validation, not a claimed fix.
