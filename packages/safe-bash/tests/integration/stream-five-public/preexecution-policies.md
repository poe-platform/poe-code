# Helper refinements, frozen before execution

The original planner documents remain unchanged. This file specifies plumbing,
not revised product expectations. No product/native execution has occurred.

- F02 uses shell quoting to dispatch one literal `|` separator. C07 separately
  exercises actual `context.invoke` literal argv through middleware.
- F08 forwards an implicit default stdin whose iterator throws on acquisition;
  it proves the named-file command does not consume it, without changing bytes.
- F07/F10 use both MemoryFileSystem and RealFileSystem. Host roots are uniquely
  created inside the isolated consumer's temporary directory; no implicit host
  path is passed to virtual commands. Root and `/parts` namespace are checked.
- C04 uses 65,536 records and the original four-byte unit. First-sink-entry and
  producer-progress acknowledgments precede the closed-gate assertion. A turn
  delay checks noncompletion but is not the only backpressure evidence.
- C05/C08 use a transparent Proxy binding all methods to the backing MemoryFS.
  All mutation methods (`writeStream`, `writeFile`, `appendFile`) are intercepted
  at `/parts/pab` before invoking the backing method. C05 blocks there until
  the received operation signal aborts; C08 throws FsError ENOSPC there. The
  completed `/parts/paa` is verified first, and `/parts/pab` must not exist.
  Signals on all supplied FS option objects are recorded, not identity-matched.
- C06 family limit failures require exit1, a command-prefixed diagnostic naming
  the actual limit, and exact observed published-prefix preservation. The seq
  low output case has expected prefix `310a`; rev lower input case has none.
  Split file-limit failure preserves only `paa=00ff41`. Shell quotas reject with
  ShellLimitError rather than being counted as family-command failures.
- Type negatives add the confirmed aggregate Omit-replace cases by assigning
  a boolean to indexed `replace` types conditionally resolved to `never`. This
  produces intended TS2322; it does not accept missing declaration failures.
- Worker imports are allowed only for the inspected regex client/worker pair.
  Runtime worker construction is guarded to packed `dist/commands/regex-execution/worker.js`;
  no child_process, cluster, external package or TypeScript product fallback.
- Current author overlay may change only aggregate registration/count/options
  and formerly absent five-name dispatch. The historical 82 inputs and native
  bytes/classifiers remain frozen and are separately hash-bound.

Before final execution, source commits and harness commits are recorded
separately. Build uses the isolated archive's actual build script; package
lifecycle hooks are rejected before npm pack. The final gate is not inferred
from an author's status document.
