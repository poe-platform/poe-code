# Named host-operation policy defaults

## Contract

At issue time, an explicit `declareHostOperation` policy wins; otherwise the
existing exact module/operation registry supplies the default; otherwise use
`re-issue`. Captured identity is immutable. Changed live policy must not
downgrade a captured effect or skip reconciliation; mismatch may fail closed.

## Bounded implementation

- Read the existing canonical named registry from `snapshot/policy.ts`; do not
  add a map, registry copy, public API or new configuration surface.
- Consult it in `interp/host-bridge.ts` after computing the existing journal
  identity, only when the function has no explicit declaration.
- Preserve strict legacy snapshot lookup, replay identity checks, source and
  argument proof validation, callback behavior and execution semantics.
- Keep shared-function and default-export journal naming unchanged. Conflicting
  alias policies are not a new identity contract; use a function declaration.

## Verification

Write a failing public-API test before changing production. Exercise modules
and bindings, issue-time updates, explicit precedence, exact-name collisions,
pending reconciliation, every proof identity field, recorded reuse, repeated
immutable capture and policy changes. Compare ordered effects as well as dumps.
Run the focused source tests and packaged public controls on Node 18.18.2,
18.20.8, 20.19.2, 20.20.0, 22.22.2 and 24.14.0. Preserve the published-C
counterexample and a separate strong red mismatch-error-shape assertion.

## Release boundaries

The baseline is published C, commit
`a21b09b450739d2ccfc44a1a17770fd86785d7e4`, without local class/V8 work.
Deliver a bounded patch and its path-mapped equivalent after the canonical
rename. Do not overwrite the rename freeze or another owner's docs increment.
Release integration/full gates remain the release operator's responsibility.
This work adds no browser runtime or exactly-once external-effect guarantee.
The public mismatch error-shape issue remains a separate follow-up.

## Release-operator reconciliation — August 30, 2026

This isolated seven-path candidate starts from the verified canonical rename
`0b10f2f4d4ccda5577b87ee72bdb85a2fa992558` / `poe-code@12.0.8`, not live work.
The exact 46-case public corpus reproduces 32 failures and 14 passing controls
on that published artifact across Node 18.18.2, 18.20.8, 20.19.2, 20.20.0,
22.22.2 and 24.14.0 before the two-file production increment is applied.
Current README release and FS-only cross-browser paragraphs are preserved;
canonical naming and legacy aliases are unchanged. Full candidate gates and
published verification are required before claiming this correction released.

Typed mismatch-error conversion remains a separate known red issue: fail-closed
policy handling is not evidence that the public error class/action is correct.
The unfinished follow-up is not included. Shared-function alias journal naming
is unchanged and makes no new independently addressed-alias policy guarantee.
