---
title: ArrayBuffer detached getter
---

# ArrayBuffer detached getter

Next lifecycle gap: the ArrayBuffer prototype installs byteLength,
maxByteLength and resizable, but not detached. Validate before implementation.
The getter must distinguish zero-length attached storage from detached storage,
reject incompatible receivers and expose standard descriptor metadata. Keep
older hosts without a native detached getter supported. This alone does not add
transfer methods or portable detached-buffer snapshots.

Validated before implementation: all three regressions fail (916 ms). Attached
buffers return undefined, and getter descriptor/direct invocation are absent.
Published 2026 section 25.1.6.3 requires a non-shared ArrayBuffer receiver and
returns its detached state, not whether byteLength equals zero.
https://262.ecma-international.org/17.0/#sec-get-arraybuffer.prototype.detached

Implemented with a captured native getter when available and a zero-length
view probe on older hosts. Receiver branding rejects shared/non-buffer values
before either path. Getter metadata and intrinsic registration follow the
existing ArrayBuffer accessor route.

Verification: nine getter tests pass; all 784 focused Float32/ArrayBuffer tests
across 49 files pass (25.13 seconds). Package TypeScript and exact-file ESLint
pass. The real harness passed after 70 uncached build tasks (61.031 seconds);
its PNG was inspected. Zero spawns validates runtime/schema, not model behavior.
Built SDK Node 18.18.0 explicitly reported nativeGetter=false, before=false and
after=true for an empty buffer detached by the host, proving fallback behavior.
No matching open issue found. Transfer remains separately validated with ten
failing native comparisons; no transfer or detached-snapshot support is claimed.
