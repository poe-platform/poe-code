# dd nofollow and synchronized output verification

Use the existing checkout and an owned temporary directory under `/out`. Do not
modify existing captures. Remove this run's temporary directory when finished.

1. Run the maintained dd tests and safe-fs descriptor tests. Confirm final symlink
   refusal, unchanged targets after failed opens, wrapper forwarding, partial-write
   flush ordering, retained inode identity, and failure cleanup.
2. With GNU dd 9.4 as a native reference, compare `iflag=nofollow`, `oflag=dsync`
   and `oflag=sync` through the actual source Shell on memory and rooted real
   filesystems. Use binary input and an existing output. Compare exit status,
   stdout, stderr and output bytes exactly.
3. On the rooted real filesystem, verify that ordinary, dangling and self-loop
   final symlinks fail with `ELOOP` without modifying the output or link targets.
   Confirm parent symlinks remain usable and exclusive creation retains `EEXIST`.
4. Inspect a terminal screenshot of the successful copy and symlink refusal.
   Keep default CLI registration unchanged; dd is an explicit plugin.
5. Run repository unit and lint routes, review the owned diff, commit the fix,
   push to main and verify the commit is present on remote main. Close issue 286.
   Release completion is outside this task at the user's request.

Memory flushes remain volatile. Native flush success and these byte/effect checks
do not test physical crash durability or hostile concurrent ancestor replacement.
