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
