# Shared replay graph roots

Dynamic module namespaces must preserve aliases to earlier named imports without
recapturing data after guest mutation. The replay codec previously allocated a
fresh graph and decoder identity map for every root. Two failing tests confirmed
that it could neither extend an existing graph nor reject a decoder memo from an
unrelated graph.

Allow encoding additional roots with a shared context and an explicit capability
path prefix. Allow decoding those roots with a memo tied to the exact node array.
Commit new decoded identities only after successful initialization. If encoding
fails, remove the incomplete appended nodes and reject subsequent use of that
context; already completed roots remain readable.

Tests cover original-state preservation across mutation, object and symbol
aliases, graph identity checks, capability paths, and failed encode/decode
recovery. Existing replay-data, replay-input, symbol and typed-array iterator
tests provide adjacent regression coverage.

This is the codec foundation only. Dynamic-import integration must still defer
unused namespace capabilities and support low-level host-export snapshots before
that feature can be delivered. This change does not claim those failures fixed.
