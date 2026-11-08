# ls human-readable sizes and metadata sorting

`ls -h` and `--human-readable` format the size field when long output (`-l`)
is selected. They do not enable long output themselves. Existing mode, link
count, numeric identity, date, suffix and symlink-target rendering stay intact;
this is not GNU column alignment, locale formatting or `total`-line parity.

## Human sizes

Sizes below 1024 remain integer bytes, without a suffix. Larger sizes use
1024-based K/M/G/T/P suffixes, rounding upward: one decimal below 10 units,
otherwise an integer. Rounding carries into the next unit instead of printing
1024 of the previous unit. Examples: 1024 is `1.0K`, 1025 is `1.1K`, 10138 is
`10K`, 10241 is `11K`, and 1047553 is `1.0M`.

The human formatter accepts nonnegative safe-integer byte sizes through
`Number.MAX_SAFE_INTEGER` (`8.0P`). Other values fail with EINVAL rather than
fabricating precision, overflowing, or looping on infinity. Exact bounded
BigInt arithmetic implements rounding; it neither allocates file contents nor
scales work with file size. This validation is local to human formatting, not
a new filesystem-wide metadata policy. Decimal SI, block-size options and
environment-controlled size formats remain unsupported.

## Ordering and operands

`-t` / `--sort=time` select newest modification time first; `-S` /
`--sort=size` select largest logical size first. Both `--sort=VALUE` and
`--sort VALUE` work for the two supported values. The last sort selector wins,
including repeated selectors in short clusters and interleaved long options.
`--` ends option processing. Other `--sort` values remain unsupported.

Equal metadata keys fall back to ascending display-name lexical order. `-r`
and `--reverse` reverse the entire order, including ties. Ordering uses numeric
comparisons, not subtraction or rounded human sizes. Lexical ties are
deterministic JavaScript string order, not host-locale collation; the native
differential cohort uses ASCII names and `LC_ALL=C`.

File operands render first, sorted as a group. Directory operands follow,
sorted as a group, with separately sorted contents. `-d` instead sorts all
operands together without listing contents or directory headers. Multiple
operands and recursive listings preserve directory headers, with a blank line
between preceding output and the next header. Original operand count controls
headers even when one operand fails. `-R` traverses subdirectories in listing
order; `-a` includes sorted synthetic `.`/`..` entries without recursing into
them, while `-A` does not add those entries.

## Links, errors and limits

Normal directory entries use lstat metadata; `-L` uses target stat metadata
for sorting, rendering and traversal. A command-line symlink to a directory
is followed by default unless `-l`, `-d` or `-F` selects the link itself.
Determining this may require one lstat and one stat. Explicit `-L` overrides
these non-dereferencing forms. Without `-L`, a missing target does not prevent
listing its link. Explicit dereference failures remain errors.

Metadata collected for sorting is reused for rendering and recursion rather
than statting each entry again. Hidden entries are filtered before metadata
collection. Per-directory entry admission remains capped before collecting
child metadata; the existing recursion-depth and ancestor-cycle checks remain.
Collection yields periodically through the existing cooperative checkpoint,
and ordering yields before and after sorting. Output still awaits each sink
write and participates in existing shell output/invocation budgets. Falsey
cancellation reasons retain identity, including cancellation after a backend
returns metadata. Direct-command callers still supply their own outer budgets.

These are per-directory/argv/shell controls, not a global tree memory quota,
atomic metadata snapshot or guarantee against opaque uncooperative backends.
Sorting needs metadata before rendering records, so a metadata failure may
leave a directory header but no records from that listing. Existing VFS error
diagnostics and status 1 are retained; valid independent operands still render.
Cached metadata is not a namespace lease. No native process, host filesystem
fallback or new backend capability is introduced. Raw listing bytes are not a
host terminal UI redesign.
