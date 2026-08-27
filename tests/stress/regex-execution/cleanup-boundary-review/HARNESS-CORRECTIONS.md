# Preserved harness corrections

The first baseline-registration.json is an import/setup failure: the verifier
incorrectly used dist/fs/memory.js rather than inspected dist/fs/memory/index.js.
It has no product-control denominator and is not product evidence.

baseline-registration-corrected.json ran 17 controls, but its reentrant fake
termination callback called an absent cleanup hook on old source. That threw
inside the fake terminate method, leaving two fake workers marked unretired.
No native workers were created. The corrected transport only makes a reentrant
call when a callback exists; the test then independently asserts its existence.
The original failed run remains archived, not overwritten.

That same initial control incorrectly required a late abort to replace an
already selected internal request error. The approved identity guarantee is
at invocation/public settlement, not an arbitrary internal session promise.
The corrected session control checks prior falsy caller abort versus worker
error, while later public controls must check abort during cleanup separately.
No original five public assertions or command fixtures changed.

baseline-registration-corrected-two.json is the corrected 17-control baseline:
4 pass, 13 fail, 17 benign fake workers all retired, strict child exit0, no
unhandled rejection. Its failed controls establish absent registration and
non-cancelling session close at the approved contract's preimplementation source,
not a claim that the older source already implements the new contract.

old-five.mjs reads the exact historical child and fixtures from 839f2d4 and
changes only the data-directory literal and case scheduler. All24 original
status/stdout/stderr assertions run; four selected original callback bodies run
unchanged. Original pipe-early within the24 plus those four are the original5.
Every generated harness has original/generated hashes in its run evidence.
The moved consumer has a different package name to prevent repository package
self-resolution; package assets are compared byte-for-byte to frozen build.

The first phase-a-registration.json reports15/17 with two opaque-host control
timeouts. Its FS fixture intercepted readFile only, but both command paths use
MemoryFileSystem.readStream when available, so the intended barrier was never
entered. That is a verifier fixture defect, not a source hang. The corrected
fixture gates both actual readStream and fallback readFile; the frozen source
and assertions about cleanup versus an entered opaque host wait are unchanged.
The initial run and all its exact child/fake retirement evidence remain intact.
