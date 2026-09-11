---
title: Exact BigInt values and arithmetic
---

Validated gaps: literals were rejected, host BigInts could not enter the sandbox,
numeric operators coerced to Number, and snapshot formats omitted BigInts.

Implement exact literals, arithmetic, comparisons, update/assignment operators,
BigInt conversion and width methods, boxing, property access, and portable
primitive/boxed snapshot values. Keep AST data JSON-safe. Preserve Number-only
conversion errors and explicit Number(BigInt) conversion. Meter operand work and
reserve output data before large arithmetic or conversion allocations.

Validate using native JavaScript comparisons, malformed numeric grammar,
checkpoint replay, boxed properties, resource exhaustion, package unit tests,
lint, types, workspace build, and this no-capability CLI harness with screenshot
inspection. Commit and push the verified change directly to main, then monitor
publication independently of subsequent work.

Follow-up audits remain required for locale formatting, every numeric-coercion
call site, intrinsic mutation/replay, and adversarial size boundaries. This change
does not establish complete BigInt or JavaScript conformance.
