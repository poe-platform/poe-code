// Archived snapshots retain the legacy Dirent.path field; current Node omits it.
import "node:fs";

declare module "node:fs" {
  interface Dirent<Name extends string | Buffer = string> {
    path?: string;
  }
}
