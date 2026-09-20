# Issue 769 remote response protocol

Base: b0b6244b7 plus owned output budget and boolean fixes. Parent assigns this
shared protocol; Franklin owns eval implementation, Dalton owns network changes.

## Interface

- Extend PlaywrightCommandResult with optional isError and rawErrorHeader.
- Preserve metadata through codegen, modal, download and trace enrichment.
- Omit Ran Playwright code only in standard JSON, retaining normal text output.
- An explicit raw error header distinguishes pinned target-resolution failures
  from browser-execution errors without embedding formatting in native messages.
- Mark a response reported only after its output sink completes successfully.
  Return a typed already-reported failure only after execution/cleanup succeed;
  the wrapper maps that exact failure to exit1 with no duplicate stderr.
- Preserve sink, budget, abort, lease and cleanup failure identity/diagnostics.

## Verification

TDD the public Shell CLI, response serialization, pending sink ownership, and
failure precedence. Verify actual source/native success JSON and the native
browser error result hook; compare pinned output/error bytes and inspect a CLI
screenshot. Franklin independently qualifies the actual eval implementation.
No storage/network/artifact/tab implementation edits in this commit.
