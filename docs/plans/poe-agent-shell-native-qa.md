# Native shell plugin QA

Use the public shell plugin with deterministic tool calls, an owned working
folder under `out`, and only owned child processes. No model invocation is needed.

1. Start a Node command in the background that prints `ready` and remains alive.
   Read its background handle, check buffered output, kill that handle, and check
   that later reads report the retired handle.
2. Run a foreground Node command that prints `ready`. Supply a notification
   callback whose promise never settles. Check that command completion still
   returns output rather than waiting for that callback. Keep the existing
   one-second completion control separate from native startup preparation.
3. Check emitted stdout/stderr notifications and bounded output buffering, then
   retire only the owned children and remove the owned folder.

Fast unit checks use the existing simulated ChildProcess streams and close events
for these same notification and background lifecycle assertions.
