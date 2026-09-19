# SDK setting admission user QA

Use in-memory inputs and explicitly injected capabilities; do not invoke native
programs, databases or network services. Preserve unrelated edits and staging.

1. Submit a csvgrep SDK request with matchfile before an invalid columns array.
   Require TypeError, no file open, no registered cleanup and no output.
2. Submit a valid matchfile request whose host changes the later columns setting
   during acquisition. Require the original selector and exact output; read
   setting getters once. Explicit null matchfile must leave pattern mode active.
3. Run the maintained csvkit workspace test and lint commands, and its selected
   uncached maintained workspace build closure.
4. Independently exercise actual Shell named-input synchronous/asynchronous read
   failures combined with cleanup failure. Require the primary path diagnostic,
   one cleanup call through disposal, and no borrowed stdin consumption on failed
   iterator acquisition.
5. Record results in docs/csvkit. Keep refusal, skipped and unmeasured cases out
   of compatibility claims. Do not commit, push or publish.
