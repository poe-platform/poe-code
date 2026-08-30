# Contract arrival and implementation traps

Curie's `07acb1a4d30b7592cf247a0220250317be4e2038` arrived during
read-only inspection. The preparation archive includes that committed type/docs
addition. It is not a ROOT-relayed runtime writer lease. No implementation or
temporary types were added here. Eight of the nine inspected integration files
remain byte-identical to reviewed `ef8bbe7`; only `src/contracts/command.ts`
differs, by the additive cleanup type/member. The exact hashes are retained.

The committed contract answers the initial questions on callback shape,
synchronous closed-admission rejection, non-callable TypeError, no ordering
dependence, duplicate registrations, idempotent finally/drain overlap, starting
all callbacks even while another remains pending, single/multiple failure
selection, exact caller identity, and no extra public error channel. Those initial
questions remain recorded in INTEGRATION.md rather than silently erased.
ROOT must still route the final contract hash and authorize a sole source writer;
Arch's ownership-specific registration/acquisition mapping remains separate.

Additional exact integration traps:

- `runtime.ts:489` converts ordinary execution errors to diagnostics/status,
  `:763` wraps dispatch failures, and `:508` awaits input close in finally. Do not
  inject a cleanup-only failure into those existing conversion paths and thereby
  turn a required rejection into status 1 or overwrite a higher-priority reason.
  Retain cleanup outcomes in the private owner and apply public precedence after
  drains; preserve existing selected execution outcomes, not hypothetical errors
  from a losing opaque handler. Any private unwind sentinel would need explicit
  handling at existing catch boundaries, never public error wrapping.
- `runtime.ts:919` recursively dispatches the `command` builtin;
  `:436` executes subshell bodies; `:1585` executes command substitutions through
  the same Runtime rather than constructing another instance. Private ownership
  must travel with per-execution IO/context or an explicit internal parameter,
  not a mutable Runtime-wide “current invocation.” Function/source/eval child
  commands need the same parent linkage. Pipeline runtimes at `:328` must inherit
  the exec owner while preserving separate branch cancellation.
- Initial argument expansion/redirection precedes dispatch. Late nested invoke
  must check admission before its input iterator is obtained at `:1321`, before
  middleware, expansion/redirection or FS work. A normal completed context cannot
  use an otherwise-unaborted signal to bypass scope closure.
- Scope closure must first seal the entire admitted subtree and then start all
  eligible cooperative hooks. Parent callbacks cannot wait for a child hook that
  has not yet started. Cache each drain promise, avoid duplicate failure recording,
  and retain registration identity independently of callback identity.
- A callback closes its resource owner's acquisition admission. Runtime cannot
  stop arbitrary handler code after a race or promise that late opaque work did
  not run. Rejecting a late registration after the handler already acquired a
  resource is insufficient; Arch's callbacks must close queued/admitted creation.
- Local Shell disposal should synchronously prevent new execs, use a shared
  disposal promise, and drain only that Shell's admitted invocation owners before
  its own plugin hooks. Active-exec tracking is absent today. Do not introduce a
  wait on arbitrary execution completion or cancel another Shell sharing registry
  definitions. Pending plugin setup/dispose behavior still needs explicit owner
  reconciliation with the existing plugin contract; no new lifecycle API is
  proposed.

No implementation claim follows from these notes. The three fresh baseline cases
do not exercise callback failures, late invoke, concurrent scopes or the five
custom pre-first-read requirements; those remain future independently verified
work after the source lease.
