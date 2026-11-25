# Trash commands

Recover deleted files with `trash-put PATH...`, inspect them with `trash-list`,
and restore an item with `trash-restore ITEM`. Listings contain the item ID,
deletion date and original path, separated by tabs.

Import `trashCommands({ backend })` from `@poe-platform/safe-bash/commands/trash`.
The host backend owns the atomic move into `/.trash/files`, freedesktop
`.trashinfo` metadata in `/.trash/info`, access checks and no-replace restoration.
Unsupported providers fail without deleting data. Limits bound operands and output.

Native Rust providers expose `SafeBashFs::trash`. This also enables the same
operation for `rm`: `-r` admits folders, `-f` ignores missing paths, and `-i`
confirms a whole subtree once. Other providers retain ordinary `rm` behavior.
No purge command or retention policy is installed by this package.

Wasm hosts declare `FileSystem.capabilities.atomicTrash` and implement `trashPut`,
`trashList(directory)` and `trashRestore(directory, item)`. Mount and device views
forward this capability; the directory selects which provider owns the trash.
Native `TrashBackend::list` and `restore` receive the provider-local directory too.

The standard JavaScript command registry includes these commands. They use the filesystem methods by default; an explicit `backend` can still be supplied to `trashCommands`. JavaScript `rm` respects `atomicTrash` before recursive traversal, including interactive removal.
