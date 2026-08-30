# Bounded PAX extensibility policy

This is a new author checkpoint, not a rewrite of the historical 29/30
independent gate or its dirty frozen inputs. Independent review and root commit
authorization remain required. No root wiring or default-command count changes.

## Parser boundary

The source change is confined to `src/commands/archive/format.ts`:

- Validate decimal byte length, complete record, terminal newline and key before
  deciding whether to decode the value. Keys remain strict UTF-8, nonempty and
  free of NUL/newline. Existing header checksum and size validation is unchanged.
- Retain the existing supported standard-key semantics, including UTF-8/NUL,
  charset, numeric, path and link checks. No mtime implementation change.
- Discard only explicitly classified optional metadata: nonempty names under
  `LIBARCHIVE.xattr.` and `SCHILY.xattr.`, and exact keys `SCHILY.fflags` and
  `LIBARCHIVE.creationtime`. Separate ACL, security-label, inode/device/link-count
  and symlink-type keys remain unclassified and rejected.
- Discarded values are opaque: no text/base64/ACL decoding, restoration,
  re-emission, path interpretation, or retention in global/local maps. This also
  accepts uninterpreted optional values whose vendor-specific semantics might
  be invalid. It is framing validation, not optional-attribute validation.
- Reject every unclassified key, including sparse maps/realsize, alternative
  file types, holes and volume layout. There is no `SCHILY.*`, `LIBARCHIVE.*`,
  `GNU.*` or arbitrary-vendor wildcard acceptance. Even a zero-length unknown
  value does not authorize layout support. New extension families need review.

This deliberately bounded support is not a general POSIX pax implementation or
universal ignore-unknown-key compliance. Ignoring an optional attribute does not
restore xattrs, ACLs, security labels, flags, ownership or creation time.
`maxPaxBytes`, total/archive/member limits and pre-publication layout rejection
remain in force. Optional values still occupy bounded input buffers, but do not
grow persistent PAX state. Default member limit stays 64 MiB and is configurable.
No rollback, stronger cancellation, privacy, lease/ABA or path-race guarantee.
Hardlinks still require actual backend link support and share backing identity;
unsupported capabilities never authorize copying the linked contents instead.

The final independent research detail was consumed before selecting this policy:
`/tmp/safe-bash-pax-research-detail.txt`, SHA256
`ced5732c0f28c92821c734e7996ff23cce79bfbeed37af915c9d898646e26247`.
The preliminary candidate also discarded three ACL keys and a direct security
label key. Those extra classifications were removed before handoff to follow
the research's bounded allowlist; they now have explicit rejection tests. This
is a recorded pre-review scope decision, not a waiver of native failures.

Research also identifies a **separate OPEN empty-value deletion concern**:
the accepted parser falls back to USTAR after deleting a key, whereas POSIX
deletion includes the corresponding base field. GNU/BSD also disagree on these
vectors. No new deletion expectation or source fix is selected here; existing
deletion tests and source semantics remain unchanged pending separate review.
The nonempty-mtime findings do not establish universal PAX precedence correctness.

## Primary format sources

Retrieved August 27, 2026; no secondary tutorial used. The POSIX page rendered
empty in the web tool, so its actual HTML was also fetched directly over HTTPS.

- POSIX.1-2024 Issue 8 `pax`: extended-header framing, key namespaces and
  global/local precedence. `https://pubs.opengroup.org/onlinepubs/9799919799/utilities/pax.html`
- libarchive v3.7.4 `tar.5`: optional attributes and layouts.
  `https://raw.githubusercontent.com/libarchive/libarchive/v3.7.4/libarchive/tar.5`
- libarchive v3.7.4 reader: `pax_attribute_xattr`,
  `pax_attribute_schily_xattr`, `pax_attribute_rht_security_selinux`,
  `pax_attribute`, `header_pax_global`, `header_pax_extensions`,
  `read_mac_metadata_blob`.
  `https://raw.githubusercontent.com/libarchive/libarchive/v3.7.4/libarchive/archive_read_support_format_tar.c`
- libarchive v3.7.4 writer:
  `https://raw.githubusercontent.com/libarchive/libarchive/v3.7.4/libarchive/archive_write_set_format_pax.c`

The reader distinguishes base64 LIBARCHIVE xattrs from length-delimited raw
SCHILY xattrs, and separately processes size-changing sparse metadata. Its
global-header path stores defaults without applying them; a TODO remains in the
local-header path. These upstream sources inform classification, but do not
identify every Apple system-library patch. Exact native evidence is separate.

## Case identities and native profiles

P01–P09 are deterministic, including previously rejected immutable native BSD
plain/gzip fixtures. P10–P11 independently generate default-format and explicit
PAX native archives in both formats, and crossread virtual archives natively.
Native subprocesses use only PATH, LC_ALL and TZ: no xattr/copyfile suppression,
no filtered archives, and no prepare-oracle/download/install step.

GNU 1.35 is the existing pinned executable with SHA256
`49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66`.
BSD identifies itself as bsdtar 3.5.3 **with libarchive 3.7.4**, executable SHA256
`bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9`.
Missing native executables cause explicit skips, not fabricated native passes;
the deterministic cases do not need native executables.

Two native-only controls must not be confused with virtual extraction errors:

1. P12 pins the original fixed-time fixture's native profiles: local time is
   1700123401125 ms for both; the following file is 1700123400000 ms with GNU
   and raw-header 1700123456000 ms with this BSD profile. No clock calibration,
   tolerance or product-derived expectation. P08 independently enforces the
   POSIX global value in VFS. The original N-GNU-in/N-BSD-in case IDs remain;
   their standard expected values now assert **virtual** fixture times, while
   the native observations and POSIX-match boolean remain recorded. Exact
   native-time assertions moved to P12 rather than being deleted or waived.
2. Default macOS BSD tar adds AppleDouble ordinary `._*` archive members and
   hides them in its default presentation. Virtual tar does not interpret these
   payload files as macOS metadata. P11 retains BSD's default listing control,
   then uses the independently pinned GNU **default** reader of those same
   unmodified BSD bytes as the raw-member listing/content oracle. All sidecar
   bytes and namespace effects are compared, not dropped. The observation
   explicitly records `presentationMatches: false`; no default-BSD presentation
   or metadata-restoration parity is claimed. Virtual-to-BSD extraction still
   uses the default BSD reader and exact declared source operands.

The first candidate's P11 listing failure exposed that the initial fixture
incorrectly equated default BSD presentation with every physical archive member.
Its raw failure remains retained. Switching to an independent GNU raw-member
oracle is an explicit fixture/profile correction, not a source behavior fix.
The first candidate's P07 diagnostic used the parent-component wording for a
symlink escape; the corrected assertion requires the actual escape category,
nonzero status, unchanged existing destination and unchanged outside sentinel.
The first baseline's scoped-type failure was the new harness's unsupported
`spawnSync` detached option typing. It was replaced by bounded asynchronous
`spawn` with explicit own-group cleanup; no product expectations were changed.
