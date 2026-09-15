# TUI primitives QA

Launch tests/fixtures/tui-primitives.mts with the installed tsx loader through terminal-pilot. This is a fake streaming application; no LLM or provider credentials are used. Capture and inspect settled terminal-png screenshots.

Performance: at 100x24 press Ctrl+G, require FPS and paint/input p95. Stream 100 updates per 16ms interval for ten seconds. PageUp must hold history; F must resume current output. Resize to 50x16 and 30x10, require complete frames and a fitted diagnostics row. Repeat light theme. Press q and require restored primary screen plus RENDER_PERFORMANCE JSON; record frames, renders, coalesced requests, paint/input percentiles and q-to-exit. Diagnostic metrics measure app dispatch/flush enqueue, not terminal pixel presentation. Idle may show zero FPS and must not create a repaint loop. Record host load and avoid universal bounds from individual runs.

Additional widget scenarios and executed results will be added with each primitive.

Widget scenario: launch with --widgets. Press g twice to collapse/expand the tool group, t twice for the task subtree, o twice for nested overlay focus, then Escape twice to restore output focus. Capture each collapsed/expanded and overlay state. Update progress/sparkline while interacting. Recheck at 100x24, 50x16 and 30x10 in both themes. Require no stale rows after collapse, no border overflow and exit code zero after q.

Executed: dark/light widget runs exited zero; inspected wide, narrow and short captures. Found and corrected stale fixture row IDs by replacing the entire widget block. Terminal-pilot RGB regression tests preserve both semicolon zero-red colors and colon color-space syntax. Performance runs and limits are recorded in the parent plan.
