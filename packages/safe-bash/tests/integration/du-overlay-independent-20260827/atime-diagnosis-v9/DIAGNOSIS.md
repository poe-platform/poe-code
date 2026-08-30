# V8 file-atime control root-cause diagnosis

Date: 2026-08-27

## Decision

The repeated v8 failures are caused by a false control assumption: a host file
atime observed immediately after `utimes` is neither a stable precondition for
a later path-based sample nor a reliable causal marker for one subsequent
content read. The exact writer of each later host atime publication is not
identifiable from Node filesystem APIs, so this diagnosis does not claim that
APFS, the candidate, or an external process is the actor. It does establish the
failure mechanism directly and rules out the fixture's other concrete
hypotheses.

The neutral diagnostic inputs were committed first at
`86dfbe9a4f86e0d7c4b084ec0c7c1c865a3f7804`. The one bounded execution then
ran three fixed iterations. It imported only Node builtins and did not import,
build, package, or execute candidate code or native `du`.

## Exact v8 call chain

The immutable v8 verifier is Git blob
`53be58713265e6647655db0086ca136237d0e7fd`; the candidate real adapter is Git
blob `fd2e528075dd2f4be46eb18e2a72fa44dbfb57c4`; and the failed fresh stdout is
Git blob `666f51eb2c9b1454beed163c125c7d8a60c4c25d`.

`withRealFixture` calls host `mkdtemp`, host `writeFile(file.bin)`, and
`createRealFileSystem({root})`. The factory validates only `/`: adapter
`stat("/")` calls `operation`, `path`, `root`, host `realpath(root)`, host
`stat(root)`, another root `realpath/stat` validation, and final host
`stat(root)`. It does not open or read `file.bin`.

For V5-023, the verifier first inventories `/file.bin` through adapter
`lstat`. `forceOldAtime` then calls host `stat(file)`, host `utimes(file,
old-atime, existing-mtime)`, host `stat(file)`, and deliberately waits until a
later wall-clock tick. `measuredStats` next calls adapter `lstat("/file.bin")`.
That adapter call performs cached-root host `realpath(root)` and `stat(root)`,
host `lstat(file)` during path walking, and host `lstat(file)` for the returned
stat. `stableStat` only copies fields. No helper or adapter content read occurs
in this setup-to-before-sample gap.

The later adapter content action is separate: `readFile` calls `operation`,
`collectBytes`, and `readStream`; path resolution uses root `realpath/stat` and
file `lstat`, then host `open(O_RDONLY|O_NOFOLLOW|O_NONBLOCK)`, handle `stat`,
positioned handle `read`, and close. V5-024 has the same setup paths for root
and file. Its instrumented action calls adapter `readFile("/file.bin")` and
then adapter `readdir("/")`; `readdir` resolves the root and performs host
`readdir(..., {withFileTypes:true})`.

Thus V5-023 and V5-024 did not confuse a relative path with a host path and did
not hide a content read in `measuredStats`, `stableStat`, path walking, cache
validation, or stat mapping.

## Raw observations

Runtime was Node v22.22.2 on Darwin 25.4.0 arm64. The filesystem `statfs` type
was recorded numerically as 26; no filesystem-name inference is needed.

- All three no-access probes retained exactly
  `946684800000000000` atime nanoseconds through immediate, microtask,
  `setImmediate`, and fixed 5 ms samples.
- Exact lstat-only v8 mimic iteration 2 changed from the observed forced value
  `946684800000000000` to `1787863155941341516` before the first file lstat
  sample. Iterations 1 and 3 retained the forced value. No content read ran in
  any mimic.
- Completed-read-then-reset iteration 3 changed from the observed forced value
  `946684800000000000` to `1787863155955345218` before its first file lstat
  sample. Iterations 1 and 2 retained the reset. This directly demonstrates
  that completion of a read and a later successful `utimes` observation do not
  establish which atime a following path sample will see.
- Configured and canonical file samples had identical device/inode pairs in
  every iteration: `16777232/177774424`, `16777232/177774438`, and
  `16777232/177774448`.
- Each of the three explicit directory listings advanced directory atime. Each
  of the three explicit file reads advanced file atime and returned the locked
  1,500-byte SHA-256
  `b935f6b7a9c56a15e7b99c8d6d4b5e918f5a68fafc4490544a446b2ae47bf809`.
  These six observations calibrate this run; they do not prove every future
  provider read must update atime.
- Fractional timestamp round trips were consistently 64 ns below the numeric
  request. V8 used an exact whole-second timestamp, so timestamp granularity is
  not the v8 failure.
- The unique diagnostic scratch ended at ENOENT. Raw stderr is empty and the
  process status is zero.

The raw JSON is preserved byte-for-byte at SHA-256
`b2ee65868b1ccd15db17e945fddab7c14546840992ff8bf408b2166bbe2dd9ab`.

## Required v9 correction

V9 must not retry for a favorable provider outcome and must not require every
real content read to advance atime. V5-023 can remain an executed locked-byte
read calibration while recording, rather than prescribing, its atime outcome.
It must still reject any non-atime field change.

V5-024 must retain an actual instrumented content read and actual directory
listing, while detecting the content-read violation from the call log rather
than using file atime as its proxy. Actual file-atime guard sensitivity must be
made deterministic by an intentional real-host file-atime perturbation to a
fixed future value inside the negative control. The complete before/after stat
delta stays visible: file atime remains unauthorized, and any accompanying
non-atime delta remains unauthorized rather than being stripped or waived.

This is policy-equivalent for product windows. Their unchanged rule authorizes
only provider/native directory atime backed by an exact same-layer/path actual
`readdir`; file atime, content reads, explicit mutation, copy-up, byte changes,
entry changes, and every other stat field remain forbidden. The correction
only removes an uncontrolled host-attribution premise from controls outside
the product window.
