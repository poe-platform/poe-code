import type { ZipEntry } from "../zip-format.js";

/** Owned local records from an explicitly requested, validated grow read. */
export const zipGrowRecords = new WeakMap<ZipEntry, Uint8Array>();
