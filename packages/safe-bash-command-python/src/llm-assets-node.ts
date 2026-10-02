import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir, open, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {collectBytes} from 'safe-bash-contracts';
import {DEFAULT_ARCHIVE_LIMITS} from 'safe-bash-io-engine/commands/archive/internal';
import {readZipArchive, decodeZipEntry} from 'safe-bash-zip-engine';
import {pythonLlmPackages, type PythonLlmPackageAsset} from './llm-packages.js';

type Distribution = typeof pythonLlmPackages.distributions[number];
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

async function readWheel(directory: string, distribution: Distribution): Promise<Uint8Array> {
  const file = await open(join(directory, distribution.file), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== distribution.bytes) throw new Error('Invalid Python wheel size: ' + distribution.file);
    const bytes = new Uint8Array(distribution.bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('Truncated Python wheel: ' + distribution.file);
      offset += bytesRead;
    }
    if ((await file.read(new Uint8Array(1), 0, 1, offset)).bytesRead || digest(bytes) !== distribution.sha256) {
      throw new Error('Python wheel digest mismatch: ' + distribution.file);
    }
    return bytes;
  } finally {await file.close();}
}

/** Explicit build-time provisioning from pinned public URLs; never called by a guest runtime. */
export async function downloadPythonLlmPackages(directory: string, options: {signal?: AbortSignal} = {}): Promise<void> {
  await mkdir(directory, {recursive:true});
  for (const distribution of pythonLlmPackages.distributions) {
    options.signal?.throwIfAborted();
    try {await readWheel(directory, distribution);continue;}
    catch(error) {if ((error as {code?:string}).code !== 'ENOENT') throw error;}
    const response = await fetch(distribution.url, {...(options.signal ? {signal:options.signal} : {})});
    if (!response.ok || !response.body) throw new Error('Could not download Python wheel: ' + distribution.file);
    const reader = response.body.getReader();
    const bytes = new Uint8Array(distribution.bytes);
    let offset = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        if (result.value.length > bytes.length - offset) throw new Error('Python wheel exceeds pinned size');
        bytes.set(result.value, offset);offset += result.value.length;
      }
    } finally {await reader.cancel();reader.releaseLock();}
    if (offset !== bytes.length || digest(bytes) !== distribution.sha256) throw new Error('Python wheel digest mismatch: ' + distribution.file);
    try {await writeFile(join(directory, distribution.file), bytes, {flag:'wx'});}
    catch(error) {if ((error as {code?:string}).code !== 'EEXIST') throw error;await readWheel(directory, distribution);}
  }
}

/** Read authenticated wheels and only their pinned native modules for static Worker imports. */
export async function readPythonLlmAssets(directory: string): Promise<{
  packages: PythonLlmPackageAsset[];
  modules: {name: string; bytes: Uint8Array}[];
}> {
  const packages: PythonLlmPackageAsset[] = [];
  const modules: {name: string; bytes: Uint8Array}[] = [];
  const signal = new AbortController().signal;
  for (const distribution of pythonLlmPackages.distributions) {
    const bytes = await readWheel(directory, distribution);
    packages.push({file:distribution.file,bytes});
    if (!distribution.nativeModules.length) continue;
    const limits = {...DEFAULT_ARCHIVE_LIMITS, maxArchiveBytes:distribution.bytes,
      maxInputMemoryBytes:distribution.bytes * 3, maxEntryBytes:distribution.expandedBytes,
      maxTotalBytes:distribution.expandedBytes, maxBufferedFileBytes:distribution.expandedBytes * 3,
      maxMembers:10000, maxPathBytes:1024, maxDepth:32, maxPaxBytes:65536,
      maxTextBytes:distribution.expandedBytes};
    const archive = await readZipArchive(bytes, limits, signal);
    for (const native of distribution.nativeModules) {
      const entry = archive.entries.find(entry=>entry.name === native.path);
      if (!entry || entry.directory || entry.symlink || entry.size !== native.bytes) throw new Error('Missing pinned Python native module: ' + native.path);
      const content = await collectBytes(decodeZipEntry(entry, limits, signal), {maxBytes:native.bytes});
      if (digest(content) !== native.sha256) throw new Error('Python native module digest mismatch: ' + native.path);
      modules.push({name:native.path,bytes:content});
    }
  }
  return {packages,modules};
}
