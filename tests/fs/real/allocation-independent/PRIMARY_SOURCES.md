# Independently checked allocation mapping

Review date: 2026-08-27. Sources were opened independently through the documentation
browser, not accepted solely from the author's reference list. No runtime, package,
container, VM, or OS download was performed. This is a source-chain review, not a
reproducible build of Node itself.

## OS units

- Apple, archived **stat(2)**, `st_blocks` description:
  <https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/stat.2.html>.
  The entry specifies 512-byte units and explains that short symlink allocation
  can be zero. This establishes the Darwin unit, not a universal POSIX unit or
  a promise that every file occupies an exclusive set of physical blocks.
- Linux man-pages, **inode(7)**, “Number of blocks allocated to the file”:
  <https://man7.org/linux/man-pages/man7/inode.7.html>.
  Both `stat.st_blocks` and `statx.stx_blocks` use 512-byte units. Holes can make
  allocation smaller than logical length. Its portability discussion explicitly
  warns that POSIX does not specify the unit universally.
- Linux man-pages, **statx(2)**, `stx_blocks`:
  <https://man7.org/linux/man-pages/man2/statx.2.html>.
  Corroborates allocation accounting for the alternate Linux statx path.

## Node-to-OS mapping, release tag v22.22.2

The documented Node `blocks` count alone does **not** establish its byte unit.
The following complete mapping was inspected:

1. Node's fs API documentation, `stats.blocks` and `stats.blksize`:
   <https://github.com/nodejs/node/blob/v22.22.2/doc/api/fs.md#statsblocks>.
   Allocation count and preferred I/O block size are separate fields.
2. Bundled libuv `uv__to_stat`, `deps/uv/src/unix/fs.c`, lines 1349–1360:
   <https://github.com/nodejs/node/blob/v22.22.2/deps/uv/src/unix/fs.c#L1349>.
   Native `st_blocks` is copied to the libuv stat result without byte conversion.
   The immediately following Apple branch concerns time fields, not allocation.
3. Bundled libuv `uv__statx_to_stat`, `deps/uv/src/unix/linux.c`, around line 1066:
   <https://github.com/nodejs/node/blob/v22.22.2/deps/uv/src/unix/linux.c#L1066>.
   Linux statx allocation is copied from `stx_blocks` to `st_blocks`, again
   without estimating from size or substituting preferred I/O size.
4. Node `FsStatsOffset`, `src/node_file.h`, lines 16–27:
   <https://github.com/nodejs/node/blob/v22.22.2/src/node_file.h#L16>.
   `kBlocks` occupies offset 9, separately from `kBlkSize` and `kSize`.
5. Node `FillStatsArray`, `src/node_file-inl.h`:
   <https://github.com/nodejs/node/blob/v22.22.2/src/node_file-inl.h>.
   The `kBlocks` field receives `s->st_blocks`; the numeric cast does not rescale
   the count. Number and bigint result arrays share this field mapping.
6. Node `StatsBase` and `getStatsFromBinding`, `lib/internal/fs/utils.js`, lines
   363–375 and 523–545:
   <https://github.com/nodejs/node/blob/v22.22.2/lib/internal/fs/utils.js#L363>.
   The JS result takes binding offset 9 as `blocks`; its constructor preserves
   that value. `size` and `blksize` remain separate values.

Thus multiplying a validated count by 512 is supported for these two OS profiles.
It is not justified for arbitrary other platforms. The verifier uses bigint
arithmetic for its expected byte conversion, rather than importing the product
conversion into the public consumer.

## Runtime qualification

The machine actually reports Darwin **25.4.0**, arm64, Node **v22.22.2**. “Darwin22”
in the assignment is treated as the Darwin/Node-22 profile, not evidence of Darwin
kernel 22. Exact OS, libuv, Node executable hash, filesystem type, and measured
entries are captured by the driver. The tag review authenticates upstream mapping;
it does not independently establish this binary's full compiler/build provenance.

Linux conversion arithmetic is exercised on Darwin using the string `linux`.
That is **not Linux execution**. No Linux filesystem, Windows, or real remote
service acceptance is claimed. A mock S3 transport and injected WebDAV response
only verify that their default metadata does not invent allocation.
