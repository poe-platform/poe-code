---
title: Replacement callback result coercion
---

The initial tests produced twenty-six failures and eight passing controls.
Both string and regex replacement passed guest callback results to host String,
ignoring guest conversion methods, accepting Symbols incorrectly, and mishandling
Promise objects. Accumulated output was also absent from live-data accounting
during later callbacks.

Use sandbox string conversion with the current call context for callback results
in replace and replaceAll. Convert each result before invoking the next callback;
callback-produced dollar sequences remain literal. Promise results, including
async callbacks, are stringified rather than awaited for their fulfillment value.

Retain accumulated output during callbacks and coercion, and release it on exit.
Low/high-budget checks cover accumulated output; a separate control verifies
that a completed large output is not counted twice. Do not increase limits.

Validate through maintained safe-js unit tests, focused native comparisons,
changed-file lint, package types, selected workspace build, and this harness
pair with screenshot inspection. No capabilities or agent spawns are required.

Next validated scope: custom exec in regex replacement, including returned match
positions and collecting all global exec results before replacement callbacks.
Species construction and remaining regex grammar gaps also remain open.
