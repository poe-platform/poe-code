# Temporal replay-data codec integration

## Scope and validation

Integrate the pending replay-data encoding and decoding for all eight owned
Temporal types, separately from guest-heap restoration and weak serialization.
This is reconciliation of existing implementation work, not a newly invented
Temporal semantics fix.

The committed codec at `5c3359b92` was evaluated without modifying the worktree:
TypeScript was transpiled in memory with imports resolved to the current owned
value modules. Encoding an owned Instant at 123 nanoseconds produced an ordinary
empty null-prototype object record; decoding it lost the Instant brand. This
confirms private-slot loss in the committed replay codec.

## Implementation and coverage

- Encode owned Temporal brands as typed records with private slots.
- Store epochs as canonical decimal strings, retaining full nanosecond range.
- Validate slot counts, types, ranges and canonical identifiers on decoding.
- Preserve aliases, cycles, symbols, data descriptors, explicit null prototypes
  and extensibility. Reject accessors without executing them.
- Keep the four dedicated Instant, Duration, PlainTime and ZonedDateTime replay
  test files with this codec. Add independent codec-only tests for PlainDate,
  PlainDateTime, PlainMonthDay and PlainYearMonth; leave combined heap tests for
  the separate heap integration.

## Verification

- Node 22: 125 tests pass across the five replay test files.
- Node 18.20.8: the same 125 tests pass across five files.
- Focused ESLint for the codec and five test files passes.
- `npx tsc --project packages/safe-js/tsconfig.json --noEmit` passes.
- The earlier workspace build handle is no longer available; no successful build
  result is inferred from that. The last full package gate remains non-green.

The public completed-host-call replay test uses the current worktree's heap and
realm machinery, including pending integration. The codec-only tests establish
the narrower data-format behavior independently of heap restoration.

## Delivery

Local atomic commit only. Pushes and releases remain on hold. Heap restoration,
weak serialization, runtime locale gaps and full-package qualification remain
unfinished; this change does not establish complete Temporal or JavaScript support.
