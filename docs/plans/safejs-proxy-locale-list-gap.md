# Proxy locale-list membership gap

## Validated public behavior

Read-only native/guest probes on main show that Proxy locale arrays lose their
entries during canonicalization (016915, 1b15ef). Native operation order is
get length, has "0", get "0". SafeJS only performs get length.

- Intl.getCanonicalLocales(new Proxy(["en"], handler)) returns [] instead of
  ["en"].
- String localeCompare and toLocaleLowerCase omit the membership/element traps
  even when their final return value happens to match the native result.

These are public guest-run defects, unlike the separately recorded internal
context-free localeCompare gap. Equal formatted outputs do not validate the
observable property protocol.

## Cause and repair requirements

canonicalizeGuestLocales in interp/intl-options.ts performs index membership
using getSandboxPropertyDescriptor, even when a guest property context exists.
It must use guest HasProperty semantics for Proxy membership before reading
each element. Preserve the original receiver, string keys, sparse-array holes,
inherited entries, abrupt traps, locale validation ordering and budget limits.
All callers of the shared locale helper need coverage, including canonical
locale lists, case mapping and Intl constructors. Validate before repairing;
do not infer every Intl path is broken merely from shared imports.

Main runtime files remain unchanged during full-package run 45190. No fix,
push or release is claimed yet.

## Independent isolated repair

Created `/tmp/safejs-proxy-locales.PWcc6S` from unchanged main, independently of
the context-free collation candidate. Sixteen of 17 initial regressions failed
before the repair (96a31a). Twelve public consumers were checked: canonical
locales, both locale case methods, localeCompare and eight Intl constructors.
Additional native comparisons cover throwing/false/virtual membership, inherited
Proxy entries and a trap that deletes an entry before its read.

The candidate replaces descriptor-based index membership with
sandboxHasProperty, using string keys and the existing budget/context. All 17
initial regressions pass (f36d6f). Added protected-property invariants,
pending/completed replay and fatal membership-loop budget tests expand the file
to 21 cases. Those plus locale-method checks pass 199 tests in six files
(cda382). This candidate does not include the internal collation repair.

Further native controls confirm externally visible errors, not just traces:
Turkish Proxy locales must map I to dotless ı, and a throwing has trap must
propagate its thrown value (2ab579). Main instead returned i and an empty list.

Main transfer remains pending while full-package session 45190 runs. Final
candidate lint/type checks and broader Intl tests are still being collected.

The broader Intl selection subsequently passed 594 tests in 26 files (5c5cc8).
Candidate runtime and regression lint report zero errors/warnings (c58678).
The maintained package TypeScript compiler with exactly one runtime-source
overlay reports zero diagnostics (ff300b). Main runtime files are unchanged
(5b5680). These isolated checks qualify the candidate, not a main delivery.
