# Indexed arrays: narrow addendum v1

Result: **source-grounded proposal / not ratified / not executed**.
This adds to, never replaces, the three original `2cb93988` documents.
No implementation, public contract change, native GO, test, parser, arithmetic,
product import, or held-module activity is claimed. Runtime remains reserved
for STACK review, then DOTGLOB; a later source window requires root selection.

The accepted binding remains 5137 base + accepted CD + LET runtime
`c26892c3`, reviewed by `08b05531`; runtime SHA256 is
`eb4588578001136b8ac011c1c458079b0c8a9f07e653938836d342dff052e193`.
The original selected 265-input composition/full846 package identity is carried
forward, not re-audited. Live runtime and shell initialization include pending
STACK differences and are excluded. SOURCE-BINDING records exact identities.

## Concrete recommendations

- Retain typed sparse bindings, absent/empty/missing distinctions and the
  root-directed first-profile canonical decimal indices 0..2147483647.
  Other index forms, indexed/compound command prefixes, associative arrays,
  namerefs and arithmetic indices remain excluded. No broad Bash claim.
- Reject converting an already-exported scalar to indexed, exporting an array,
  and scalar command prefixes targeting arrays. Standalone scalar assignment
  to an existing array still addresses zero. Whole-variable unset followed by
  assignment is the supported back-conversion route; `declare +a` stays future.
  This avoids implicit serialization through the existing string environment.
- CHOICES gives an exact 13-name core conversion-refusal list, separate
  boundary-only locale/temp consumers, and an ordinary-name policy without an
  `LC_*` blanket. Missing Bash-special implementations gain no implied support.
  Invocation and middleware scalar overlays need typed snapshots, not array
  element-zero writes; `replaceEnv` retains its exact exported-map contract.
- Recommend strong target-only staged publication. Resolve owner/name,
  generation and mutation version once; prevalidate known readonly/control/export
  restrictions before array RHS. RHS sees the live prior target, not private
  staging. Evaluate left-to-right once. Recheck readonly and identity/version
  before one synchronous publication; never retry expansion. RHS side effects
  survive stage failure. Existing scalar assignment ordering is unchanged.
- Choose bounded full-map metadata copies with refcounted immutable value
  storage, rather than a persistent-map implementation. Append clones existing
  slots; replacement starts empty. Local saves and child clones are charged,
  not free aliases. Function restoration covers the entire typed binding on
  return/error/abort without overriding the primary cleanup outcome.
- Existing readonly/export listing uses scalar JSON quoting, not an array
  formatter. Choose explicit status-2 refusal for a listing containing arrays;
  `set` without arguments remains unsupported. `declare`/`typeset` remain future,
  with no success stub. Local/readonly creation and diagnostic ordering are
  specified as proposals, not observed GNU tuples.

ACCOUNTING supplies finite private B/F-derived caps, pre-admission and ownership
rules, cumulative versus retained counters, and a small arithmetic-only example.
Accepted Runtime children reuse `this.budget`; `environment()`, `parentBudget`
and `newBudget` are not symbols in the inspected accepted source. Recreating a
ledger during child cloning would introduce a bypass. Root must define the
new-Shell.exec/host-process boundary and ratify caps/error policy; no new public
limit or asynchronous LET API is proposed.

## Unexecuted preseal

The existing GNU 5.3 binary and manual match published LET provenance by
read-only SHA256/size checks; no version invocation occurred. Sixteen static
rows have null native expectations. PROTOCOL limits calls, time, bytes, owned
fixtures, environment and process-group cleanup. MANIFEST seals rows, source
identity and document bytes before commit. **execution NOT_AUTHORIZED;
nativeCalls 0**. Async parent reentrancy/readonly races cannot be qualified by
subshell mutation; they remain future product-design obligations.

Root choices remaining: ratify the stricter export/control/local policies,
prior-target RHS visibility and stale-target failure, listing refusal, private
caps/ledger boundary, then separately authorize any native capture. No runner
or execution permission is included.
