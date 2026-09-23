# Issue 427 JSON filter protocol QA

The delivery is an explicit JSON protocol adapter and Safe Bash capability
forwarding. Genuine bundled JSON/Lua/citeproc engines remain outside this delivery;
issue 427 must stay open. This is not a native-fallback integration.

1. Confirm the new filter protocol, capability preflight, and request mutation
   regressions fail before implementation, then pass after implementation.
2. Build the selected Pandoc workspace with its maintained dependency closure.
   Run its lint, typechecks, and full unit suite. Run the registered Pandoc
   command and safety tests through Node/tsx using the source condition.
3. Use an owned temporary output directory for a real Python identity filter
   with the issue's JSON parse/dump body, plus an uppercase variant. Bind the
   exact Python executable only in the ad hoc oracle callback. Feed actual
   Pandoc JSON stdin and the writer argument through createJsonFilterCapability.
   Compare SDK and actual Shell stdout with the expected Hello/HELLO HTML.
4. Repeat the actual Shell calls with its memory filesystem and explicitly rooted
   real filesystem. Check ordered filters, nonzero filter status, invalid JSON,
   unchanged existing output after failure, and refusal without a capability.
   The callback's explicit oracle authority does not become a product default.
5. Capture and inspect terminal output for a successful local filter conversion
   and the missing-capability diagnostic. Use the repository screenshot route
   with an explicit output path; keep temporary evidence under out and purge it.
6. Run repository lint and npm test for the workspace boundary change. Record
   scoped checks and full checks distinctly, then commit only the owned files,
   push to main, and verify remote main contains the delivered commit. Do not
   close 427 or claim a release from this partial delivery.
