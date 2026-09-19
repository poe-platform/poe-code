# Independent SQL stream boundary findings

The actual Safe Bash Shell passes five injected in-memory lifecycle checks:

- sql2csv and csvsql preserve the header and a complete quoted multiline row
  before a late fetch diagnostic, returning status 1 with exact diagnostic bytes.
  Iterator return, result close, rollback and session close occur once.
- csvsql caller cancellation during commit waits for its admitted work. A late
  successful commit closes without rollback; a rejected commit rolls back before
  closing. Both retain the original caller cancellation object.
- The explicit MSSQL JavaScript transport tolerates a throwing request.cancel()
  under actual Shell cancellation. The admitted query drains before connection
  release, and original caller cancellation wins. The integration regression
  complements the root-owned failing transport regression and fix.

No further product defect was validated in this review. The first csvsql fixture
attempt omitted `-y 0` and encountered the explicit empty-stdin sniff qualification
blocker; correcting fixture argv reached the intended SQL lifecycle without
changing that product behavior.

Verification: the focused Node test command completed with 5 passes, 0 failures
and 0 skips after the maintained selected safe-bash build closure. Test fixtures
use memory only. No additional product source changes were required by this agent.

These are cooperative host-binding checks, not frozen external-driver error
comparisons or real-service passes. Real service behavior remains unmeasured here.
