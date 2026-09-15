# Toolcraft request cancellation

Reproduced an ordinary MCP handler receiving no AbortSignal although the core supplied one. Without that signal, cancellation stops response delivery but leaves command work running without notification.

Expose an optional signal in ordinary HandlerContext and propagate the core request signal to MCP command contexts. Streaming contexts retain their required signal. HTTP transport contexts continue carrying request services and authentication alongside the core signal.

Validation: the focused test observes a real signal, aborts the originating request, and verifies exactly one handler cancellation callback. Combined request-signal and runtime checks: 17 passing tests. Additional audit work: cancellation during asynchronous requirement/service resolution and gated approval, and SDK cancellation options.

A second focused test reproduced execution after cancellation while request services were pending. Check the signal before setup and after awaited services/requirements; rethrow cancellation before error-report generation. Awaiting the captured registered handler makes this regression deterministic without timeout-based proof. Gated approval cancellation is covered in its separate plan and tests.
