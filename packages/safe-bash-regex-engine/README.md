# Bounded data matching

The internal regex engine supplies the shared text/query matcher and ERE
algorithms used by Safe Bash commands. It preserves capture behavior, explicit
work limits and cooperative cancellation without executing host utilities.
Replacement buffers preserve Unicode with finite or unlimited limits and do not
require the Node.js `Buffer` global.
Large and deeply nested patterns use the caller's compilation budget. Parsing
and compilation avoid recursive traversal, and cancelled compilation can be
retried without exposing a partial program.

Use commands through `@poe-platform/safe-bash` and its existing command exports. This
private workspace is bundled into Safe Bash and is not independently published.

`Pattern` accepts an optional sixth argument, `PatternLimits`, to bound instructions before eager compilation. `TextProgramOptions.maxPatternInstructions` bounds expanded regex instructions during preparation and matching. Omission or `Infinity` disables this quota; a finite limit includes the final match instruction and applies to reused and eagerly compiled patterns.
