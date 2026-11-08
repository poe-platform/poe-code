import type { Runtime } from '../runtime.js';
import { virtualPath } from '../runtime.js';
import { PythonException } from '../diagnostics/index.js';
import { CsvkitBlocked } from '../errors.js';

/** Binary files are reopened by name; neither text decoding nor stdin participates. */
export async function dbfFile(runtime: Runtime, path: string, exact = false): Promise<{ path: string; bytes: Uint8Array } | undefined> {
  if ([...path].some(char => '*?[]'.includes(char))) throw new CsvkitBlocked('DBF filename glob patterns');
  const fs = runtime.context.fs;
  if (fs.listDirectory) {
    const slash = path.lastIndexOf('/'); const directory = slash < 0 ? '.' : path.slice(0, slash) || '/';
    const name = path.slice(slash + 1);
    let names: readonly string[];
    try { names = await fs.listDirectory(virtualPath(runtime.context.cwd, directory), { signal: runtime.context.signal }); }
    catch (failure) {
      runtime.context.signal.throwIfAborted();
      if (failure && typeof failure === 'object' && 'code' in failure && ['ENOENT', 'ENOTDIR'].includes(String(failure.code))) return undefined;
      throw failure;
    }
    runtime.step(); runtime.retain(names.reduce((size, entry) => size + 64 + entry.length * 2, 0));
    const found = names.find(entry => { runtime.step(); return exact ? entry === name : entry.toLowerCase() === name.toLowerCase(); });
    if (found === undefined) return undefined;
    path = slash < 0 ? found : path.slice(0, slash + 1) + found;
  }
  const chunks: Uint8Array[] = []; let size = 0;
  try { for await (const chunk of runtime.bytes(path)) { chunks.push(chunk); size += chunk.length; } }
  catch (failure) {
    if (failure instanceof PythonException && failure.exceptionClass === 'FileNotFoundError') return undefined;
    throw failure;
  }
  runtime.retain(size); const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { runtime.step(); bytes.set(chunk, offset); offset += chunk.length; }
  return { path, bytes };
}

export function bytesRepr(bytes: Uint8Array): string {
  const quote = bytes.includes(39) && !bytes.includes(34) ? '"' : "'";
  let text = 'b' + quote;
  for (const byte of bytes) {
    if (byte === 92 || byte === quote.charCodeAt(0)) text += '\\' + String.fromCharCode(byte);
    else if (byte === 9) text += '\\t';
    else if (byte === 10) text += '\\n';
    else if (byte === 13) text += '\\r';
    else if (byte < 32 || byte > 126) text += '\\x' + byte.toString(16).padStart(2, '0');
    else text += String.fromCharCode(byte);
  }
  return text + quote;
}
