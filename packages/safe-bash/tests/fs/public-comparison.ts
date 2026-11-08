import { createReadOnlyFileSystem, type FileSystem, type FsOptions } from "poe-code/safe-fs";

export function compareEntries(filesystem: FileSystem, path: string, peer: FileSystem, peerPath: string, options: FsOptions = {}) {
  const view = createReadOnlyFileSystem(filesystem);
  return view.compareEntry(path, peer, peerPath, options);
}
