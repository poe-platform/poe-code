import type { FileSystem } from '@poe-code/safe-fs/core';

export { acquire, connect } from '@cloudflare/playwright';
export const artifactFileSystem: FileSystem;
/** Copies bytes into the portable provider's protocol payload representation. */
export function prepareFileBytes(bytes: Uint8Array): Uint8Array;
