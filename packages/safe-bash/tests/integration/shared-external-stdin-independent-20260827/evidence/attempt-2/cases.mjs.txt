export const baseline = "eaed12f88365e69597994c4f2e6324a020202b66";
export const authorEvidence = "28f13113fcc57c60f90cf385f33ccc58db580a06";
export const authorHarness = "8aa4db42a6ff22fabeea9057b7c111f1506490b9";

export const cases = [
  ...["sync", "reject", "zero"].map(mode => ({ id: `direct-head-${mode}`, kind: "directHead", mode, expected: "head emits first two binary bytes, reports return failure as status 1, closes once without second read" })),
  { id: "direct-helper-eof-no-close", kind: "directEof", expected: "readBytes reaches EOF without return, preserves binary bytes and no speculative reads" },
  { id: "direct-helper-deferred-return", kind: "directDeferred", expected: "early direct readBytes remains pending until return rejection, preserving exact Error" },
  ...["sync", "reject", "zero"].map(mode => ({ id: `shell-eof-${mode}`, kind: "normal", mode, operation: "drain", expected: "outer owning close failure rejects even after EOF; binary output survives and return occurs once" })),
  ...["sync", "reject", "zero"].map(mode => ({ id: `shell-early-${mode}`, kind: "normal", mode, operation: "head -c 2", expected: "outer owning close failure rejects after two binary output bytes without extra reads" })),
  ...["sync", "reject", "zero"].map(mode => ({ id: `shell-status17-unread-${mode}`, kind: "normal", mode, operation: "status17", expected: "nonzero status is not an execution rejection; awaited close failure must reject, without reading stdin" })),
  { id: "shell-deferred-eof-return", kind: "normalDeferred", expected: "EOF output is complete but exec waits for unregistered return before propagating its rejection" },
  ...["zero", "error"].map(mode => ({ id: `shell-primary-read-${mode}`, kind: "primary", mode, expected: "selected read rejection retains exact identity over a secondary close failure; one read, one close" })),
  { id: "shell-primary-sink-error", kind: "sink", expected: "selected output sink Error retains exact identity over return failure and records attempted binary bytes" },
  ...["zero", "error"].map(mode => ({ id: `shell-abort-pending-next-${mode}`, kind: "abort", mode, expected: "caller reason identity wins; opaque next/return may remain pending; controlled late rejections are observed" })),
  { id: "shell-abort-pending-return-zero", kind: "interruptReturn", mode: "abort", expected: "reason 0 interrupts already awaited unregistered return; late return rejection is observed" },
  { id: "shell-dispose-pending-return", kind: "interruptReturn", mode: "dispose", expected: "dispose and exec settle before unregistered return; exec reports disposed and late return rejection is observed" },
  ...["abort", "dispose"].map(mode => ({ id: `shell-opaque-generator-${mode}`, kind: "generator", mode, expected: "pending async-generator next cannot be forcibly retired; public cancellation precedes controlled finally release, one return only" })),
  { id: "shell-sequential-nested-binary", kind: "sequential", expected: "nested literal invocation and later siblings consume three binary chunks from one cursor, no intermediate close or extra read" },
  { id: "shell-concurrent-sibling-abort-isolation", kind: "siblings", expected: "aborting one invocation does not abort or close its active sibling, which completes independently with exact binary output" },
  ...["host", "vfs"].flatMap(resource => ["normal", "dispose"].map(mode => ({ id: `registered-${resource}-${mode}`, kind: "registered", resource, mode, expected: "registered idempotent cooperative cleanup keeps exec pending; concurrent disposal also waits; release and resource retirement happen exactly once" }))),
  { id: "registered-host-abort-zero", kind: "registered", resource: "host", mode: "abort", expected: "registered cleanup delays rejection until released, then exact caller reason 0 wins" },
  { id: "registered-vfs-status17-cleanup-error", kind: "registered", resource: "vfs", mode: "failure", expected: "registered VFS cleanup rejection beats a nonzero command result and preserves exact Error identity" },
];

export const controls = [
  { id: "bad-swallow", case: "direct-helper-deferred-return", expected: "same benign case fails when its awaited return rejection is deliberately swallowed in a scratch iterator adapter" },
  { id: "late-unhandled", case: "shell-abort-pending-next-error", expected: "strict child fails on an intentionally unobserved fork of the existing late return rejection" },
];
