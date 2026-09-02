# Concise shared Vitest progress

## Change

The shared runner inherited Vitest's dot reporter, which writes one character
for every completed case. The latest full control printed nearly 30,000 dots
without identifying the current workspace. Replace that progress stream with
one start line per nonempty sequential phase and the existing cumulative final
summary. Use Vitest's exported default reporter with its live summary disabled;
print individual module details only for failures. Do not change worker limits,
per-file isolation, discovery, case membership, snapshot handling or exit status.

## Validation

- Two new controls fail before the implementation and pass afterward.
- All 247 ownership, routing, lifecycle and shared-runner controls pass.
- Real Node 22.23.2 two-phase controls retain worker isolation and native TEST
  startup markers. Passing execution exits zero; assertion, import, hook and
  unhandled-error variants exit one and retain their source diagnostics.
- An earlier phase's obsolete-snapshot warning remains visible before the next
  phase resets snapshot state. No progress-dot stream remains.
- Logs: `/tmp/poe-shared-summary-{red,green}.json` and
  `/tmp/poe-shared-summary-control-{pass,test,import,hook,unhandled}.log`.

This is an output reduction, not a measured test-runtime improvement. Release
publication and the complete CI runtime target require separate verification.
