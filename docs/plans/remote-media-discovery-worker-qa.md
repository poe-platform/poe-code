# Remote media discovery Worker QA

Validate local discovery separately from remote native execution. The automated
checks cover parser compatibility, bounded pulls, metadata budgets, injected
filesystem authority, and cleanup; they do not qualify Worker peak memory.

1. Deploy the media command adapter in workerd and a Cloudflare staging Worker,
   using an injected external safe-fs backend with genuine streaming or retained
   range reads. Reject `readFile`, private RAM storage, and host temporary files
   for discovery. Log read ranges, live handles, outstanding bytes, and writes.
2. Generate 1 MiB, 64 MiB, and 1 GiB media objects externally. Run native identify
   and conversion through the existing authenticated remote binding. Verify no
   local discovery reads of ordinary media, identical original argv and upload
   descriptors, and byte-identical output versus direct native execution.
3. Repeat with response/list files and magick scripts of increasing sizes:
   whitespace/comment padding, quoted filenames across chunk boundaries, CRLF,
   escaped newlines, inline-file operands, NUL-terminated lists, and malformed
   scripts after completed commands. Check dependencies, diagnostics, ordered
   writes and partial effects against pinned native ImageMagick.
4. Include over 4,096 names and tokens exceeding 64 KiB. Confirm bounded advisory
   predictions and a deferred-budget record, while native execution processes
   the entire original input, including operands beyond the prediction prefix.
5. Run concurrency 1, 4, and 16 with a deliberately slow remote upload/output
   consumer. Cancel during discovery and upload; inject backend read/close errors.
   Verify cleanup, caller cancellation propagation, retained identity, and no
   buffered fallback or unauthorized storage allocation.
6. For every size/concurrency/backend combination record actual workerd and
   Cloudflare memory high-water, CPU time, time to first remote byte, total time,
   maximum outstanding discovery bytes, and handles after completion. Use Worker
   runtime profiling/observability; Node heap-only measurements are insufficient.
   Compare memory growth against payload size and distinguish remote transfer
   buffering from discovery. Expected discovery storage is one backend chunk
   plus bounded token metadata per input, never media-sized resident storage.
7. Retain measured results with the staging qualification run, including runtime
   version, backend capability declarations, native build digest and any failure.
   Do not claim Cloudflare qualification until those measurements are available.
