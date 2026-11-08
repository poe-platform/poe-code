# Virtual filesystem devices

This document describes virtual-device support in the current source. Earlier
releases may not include these exports; issue #700 tracks publication verification.

SafeBash installs a device view around the filesystem selected for each root
execution. This includes `Shell.exec` filesystem overrides. Redirections and
commands use the same view; there is no host `/dev/null` dependency.

Applications that access their filesystem outside Shell can install the same
view explicitly through the portable public SafeFS entrypoint:

```ts
import { createDeviceFileSystem } from "@poe-platform/safe-fs/core";

const filesystem = createDeviceFileSystem(applicationFileSystem);
await filesystem.writeFile("/dev/null", new TextEncoder().encode("discarded"));
const empty = await filesystem.readFile("/dev/null");
```

`createDeviceFileSystem` returns a `DeviceFileSystem`. Rewrapping that view is
idempotent. There are no environment variables or configuration options.

## Null-device behavior

- `/dev/null` exists without allocating a backing file. Reads immediately reach
  EOF; normal and append writes discard bytes. Exclusive creation rejects with
  `EEXIST` even when the backing store has no null row.
- File metadata uses `FileType` value `"character"`, zero size and allocated
  bytes, character-device mode `020666`, and stable view-owned identity. Bridge
  stats report `isCharacterDevice()`, not `isFile()`.
- `/dev` is visible as a directory. Root and device-directory listings include
  the virtual entries, merge backing siblings, mask historical null entries,
  and enforce `maxEntries` rather than truncating results.
- Using the device as a directory fails with `ENOTDIR`. Removing or replacing
  reserved device entries, including destructive ancestor operations, is
  rejected. Ordinary backing-file capabilities and identity remain separate
  from the writable virtual device.
- Stream writes drain without collecting the input. They yield cooperatively,
  observe cancellation, and await owned producer cleanup. Cleanup errors do not
  replace an earlier source failure or cancellation reason.

The view does not grant write access to ordinary files on a read-only backing
filesystem. Use `capabilitiesFor(path)` to distinguish backing paths from the
device; a mixed view's global capabilities are not a promise that every path is
writable.

Existing symlink aliases are resolved through entry metadata, including on
read-only filesystems and mixed mounts. A global symlink-creation flag does not
establish whether existing links can be followed. If a discovered link cannot
be resolved, the view rejects the operation instead of forwarding a possible
device write to storage.

## Historical data and persistence

Existing backing `/dev/null` records are masked, not deleted or rewritten.
Virtual-device operations must not consume the backing store's file quota or
publish discarded bytes. Applications remain responsible for explicitly cleaning
up old records if desired.

Prompt listings and other application code that bypass the device view still
see raw historical rows. Use the view for those accesses or filter the old rows
until an intentional cleanup is performed. Installing the view is not a storage
migration.

## Validation boundary

Validation covers actual Shell workflows, backing-store
mutation spies, installed Node/Bun/browser consumers, and real workerd execution
against persisted R2 storage across runtime recreation. The development plan and
acceptance status are tracked in `docs/plans/issue-700-virtual-null-device.md`.
Source documentation alone does not establish that an older installed npm version
contains the implementation.
