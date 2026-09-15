# MCP client stdio input bounds

Five failing tests reproduced unbounded complete/incomplete lines and invalid UTF-8 being replaced in protocol values. Bound each input frame independently to 16 MiB, count UTF-8 bytes, and decode byte input strictly. Scan only newly received text for newline framing to avoid repeatedly scanning a growing partial line. Preserve CRLF normalization and existing trailing-line utility behavior.

Focused line and terminal command metadata tests are green. Add invalid limit, split multibyte and message-layer failure propagation cases, then full client validation and build/type checks.
