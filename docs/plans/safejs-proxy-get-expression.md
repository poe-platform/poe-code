# Guest Proxy member reads

Nine interpreter tests fail on 18fc4db1d (89541): direct and inherited traps,
symbol inheritance, intrinsic shadowing, accessor receiver forwarding,
Proxy-backed handlers, method receivers, protected values and destructuring.

Let ordinary descriptor lookup report a Proxy boundary without traversing its
carrier. The interpreter resumes through the shared Get operation, preserving
the original receiver (including super). Existing descriptor-only callers retain
their current behavior until their own Proxy integration. Ordinary property
reads retain the existing accessor and built-in fallback paths.

The initial selection passed 36 tests across four files (96130), followed by
successful TypeScript and scoped lint. The expanded selection includes super,
array-prototype, own-shadowing and private-brand controls, plus maintained
accessor, member-key conversion, array-prototype and eval-super tests (86380).
It completed successfully: 429 tests across eight files and final test-file lint.

This integrates guest member reads and handler lookup, not public construction,
callable Proxy identity, writes, enumeration, snapshots or all async array-method
operations. Descriptor conversion and with-environment presence checks remain
separate integration work. No full-package success or publication is claimed.
