# Cancellation during approval

Two failing tests demonstrated that an already cancelled request still opened approval and that cancellation during pending approval still allowed the handler to run after approval returned.

Check the optional handler signal before approval, after asynchronous plan/storage/provider steps, and before spawning an asynchronous runner. Ordinary SDK/CLI behavior remains unchanged when no signal is supplied. Propagated MCP request signals prevent abandoned requests from executing their approved commands later.

Validation: 16 gate, ordinary MCP cancellation and MCP approval integration checks pass. Further audit must cover provider-side cancellation and cancellation during service/requirement resolution.
