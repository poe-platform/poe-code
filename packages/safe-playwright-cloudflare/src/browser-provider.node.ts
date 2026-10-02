import { Buffer } from 'node:buffer';
import type { FileSystem } from '@poe-code/safe-fs/core';

export { acquire, connect } from '@cloudflare/playwright';
export const artifactFileSystem: FileSystem | undefined = undefined;

/** The native provider validates its own binary payload class. */
export function prepareFileBytes(bytes: Uint8Array): Uint8Array {
  return Buffer.from(bytes);
}
