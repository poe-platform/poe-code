# Temporal format and offset user QA

1. Use the hash-locked CPython 3.14.2 / csvkit 2.2.0 reference with C locale,
   UTC, UTF-8 non-TTY pipes and 80 by 24 terminal metadata.
2. Compare explicit Date formats with repeated spaces and U+0085 whitespace.
   Compare aware DateTime sorting with positive and negative offset seconds
   and fractional seconds, preserving displayed offsets.
3. Reproduce differences with failing in-memory canonical tests before fixes.
   Assert exact engine stdout, stderr and status; reject unexpected filesystem
   reads or writes. Independently stress registered Shell commands with another
   agent, including Unicode duration units and parsedatetime small-year quirks.
4. Run the maintained csvkit unit, lint and selected workspace build closure;
   exercise all csvkit integration files and maintained safe-bash type checks.
5. Render actual registered command output and inspect its screenshot. Reduce
   reference facts and outcomes into docs/csvkit, then purge owned out evidence.
   Preserve unrelated output, source and staging. Do not commit or publish.
6. Record outstanding temporal and broader command surfaces as blockers;
   these finite tests cannot qualify full csvkit compatibility.
