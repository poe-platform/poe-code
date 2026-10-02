import { byteText, textBytes } from './bytes.js';
import type { ReferenceKind, ResolutionBase, ResolutionOptions } from './resolution-types.js';

/** Selected POSIX libavformat avio.c protocol spelling. Do not apply browser
 * scheme normalization: numeric prefixes and unknown/case-mismatched protocols
 * must stay native accesses, and subfile has a comma-delimited option prefix. */
export function protocol(value: string): string | undefined {
  if (value.startsWith('subfile,') && value.indexOf(':', 8) >= 0) return 'subfile';
  const end = value.indexOf(':');
  if (end < 0) return;
  const scheme = value.slice(0, end);
  if ([...scheme].every(c => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+.-'.includes(c))) return scheme.startsWith('crypto+') ? 'crypto' : scheme;
}
export function classify(value: Uint8Array): ReferenceKind {
  const name = byteText(value), scheme = protocol(name);
  if (name === '-' || scheme === 'pipe' || scheme === 'fd') return 'descriptor';
  if (scheme === 'file') return 'file-protocol';
  return scheme !== undefined ? 'url' : 'path';
}
/** avio.c's subfile option prefix selects its own single-byte separator.
 * There is no quoting/escaping here. subfile.c strips the reconstructed prefix
 * only when it is exactly "subfile:"; offsets are native AVOption expressions. */
export function subfileOperand(value: string): string {
  if (value.startsWith('subfile:')) return value.slice(8);
  const separator = value[8];
  if (!value.startsWith('subfile,') || !separator) throw new SyntaxError('Invalid subfile option prefix');
  let start = 9;
  while (start < value.length) {
    const keyEnd = value.indexOf(separator, start);
    if (keyEnd < 0) break;
    if (keyEnd === start) {
      const suffix = value.slice(start + 1);
      return suffix.startsWith(':') ? suffix.slice(1) : 'subfile' + suffix;
    }
    const valueEnd = value.indexOf(separator, keyEnd + 1);
    if (valueEnd < 0) break;
    if (!['start', 'end'].includes(value.slice(start, keyEnd))) throw new SyntaxError('Unknown subfile option');
    start = valueEnd + 1;
  }
  throw new SyntaxError('Unterminated subfile option prefix');
}
/** RFC-style reference resolution without decoding/re-encoding signed octets.
 * Absolute references are returned byte-for-byte. Local paths NEVER use URL or
 * lexical dot-segment normalization. */
export function resolveLocation(value: Uint8Array, base: ResolutionBase, literal = false): Uint8Array {
  // Interpret owned native buffers, not caller-shadowed lengths or iterators.
  // Losing a network base here would turn a relative member into a local path.
  value = new Uint8Array(value);
  let name = byteText(value), source = byteText(new Uint8Array(base.value));
  if (!literal && protocol(name) !== undefined) return new Uint8Array(value);
  if (!literal && protocol(source) !== undefined && protocol(source) !== 'file') {
    // url.c ff_url_decompose accepts reference schemes up to the first
    // : / ? or #, including option syntax that AVIO's protocol selector does
    // not recognize. Keep those references intact; native AVIO still decides
    // whether the resulting operand selects a protocol or a local file.
    let delimiter = 0;
    while (delimiter < name.length && !':/?#'.includes(name[delimiter])) delimiter++;
    if (name[delimiter] === ':') return new Uint8Array(value);
    const colon = source.indexOf(':');
    const scheme = source.slice(0, colon + 1);
    const networkRelative = name.startsWith('//');
    if (networkRelative) source = scheme + name;
    const hasAuthority = source.startsWith('//', colon + 1);
    const authorityStart = hasAuthority ? colon + 3 : colon + 1;
    let authorityEnd = authorityStart;
    while (hasAuthority && authorityEnd < source.length && !'/?#'.includes(source[authorityEnd])) authorityEnd++;
    const origin = source.slice(0, authorityEnd);
    if (networkRelative) name = source.slice(authorityEnd);
    const hash = source.indexOf('#');
    const noHash = hash < 0 ? source : source.slice(0, hash);
    const query = noHash.indexOf('?');
    const plain = query < 0 ? noHash : noHash.slice(0, query);
    // Native url.c keeps every base component for an empty reference, including
    // its fragment. A newly supplied query or fragment replaces that component.
    if (!name) return textBytes(source);
    if (name[0] === '#') return textBytes(noHash + name);
    if (name[0] === '?') return textBytes(plain + name);
    let suffix = name.length;
    for (const delimiter of ['?', '#']) { const at = name.indexOf(delimiter); if (at >= 0) suffix = Math.min(suffix, at); }
    const relative = name.slice(0, suffix);
    const directory = base.kind === 'directory' ? plain.slice(origin.length) : plain.slice(origin.length, plain.lastIndexOf('/') + 1);
    const prefix = directory ? directory + (directory.endsWith('/') ? '' : '/') : hasAuthority ? '/' : '';
    const path = relative.startsWith('/') ? relative : prefix + relative;
    // Selected url.c simplifies parents only for scheme:// authorities.
    // Pseudo-protocol paths can reach symlinks and retain native '..' semantics.
    if (!hasAuthority) return textBytes(origin + path + name.slice(suffix));
    const parts: string[] = [];
    for (const part of path.split('/')) {
      if (part === '..') { if (parts.length > 1) parts.pop(); }
      else if (part !== '.') parts.push(part);
    }
    if (path.endsWith('/.') || path.endsWith('/..')) parts.push('');
    return textBytes(origin + parts.join('/') + name.slice(suffix));
  }
  if (name.startsWith('/')) return new Uint8Array(value);
  const local = source.startsWith('file:') ? source.slice(5) : source;
  const directory = base.kind === 'directory' ? local : local.slice(0, local.lastIndexOf('/') + 1);
  return textBytes((source.startsWith('file:') ? 'file:' : '') + directory + (!directory || directory.endsWith('/') ? '' : '/') + name);
}

export async function traceLocal(location: Uint8Array, options: ResolutionOptions, remainingBytes: number): Promise<{ bytes: number; location: Uint8Array; trace: { path: Uint8Array; target?: Uint8Array }[]; issue?: 'budget' | 'unresolved' | 'cycle' }> {
  const trace: { path: Uint8Array; target?: Uint8Array }[] = [];
  let bytes = 0;
  // Without canonical metadata preserve the unresolved spelling, including '..'.
  if (!options.link) return { bytes, location, trace };
  const pending: (string | { endLink: string })[] = byteText(location).split('/');
  const active = new Set<string>();
  const resolved: string[] = [];
  let links = 0;
  let suffix = '';
  while (pending.length) {
    const part = pending.shift()!;
    if (typeof part !== 'string') { active.delete(part.endLink); continue; }
    // A terminal slash/dot still requires a directory at native access. Keep
    // this requirement even when it came from the final symlink target.
    const terminal = !pending.some(component => typeof component === 'string');
    if (!part || part === '.') {
      if (terminal) suffix = part === '.' ? '/.' : '/';
      continue;
    }
    if (part === '..') { resolved.pop(); if (terminal) suffix = '/'; continue; }
    const path = textBytes('/' + [...resolved, part].join('/'));
    if (bytes + path.length > remainingBytes) return { bytes, location, trace, issue: 'budget' };
    bytes += path.length;
    let target: Uint8Array | undefined;
    // Metadata adapters may reuse their argument buffer. Keep the traversal
    // spelling and active symlink key owned independently of that callback.
    try { target = await options.link(Uint8Array.from(path)); }
    catch { return { bytes, location, trace, issue: 'unresolved' }; }
    if (target && target.length > remainingBytes - bytes) return { bytes, location, trace, issue: 'budget' };
    bytes += target?.length ?? 0;
    trace.push({ path, target: target ? Uint8Array.from(target) : undefined });
    if (target) {
      const key = byteText(path);
      if (active.has(key)) return { bytes, location, trace, issue: 'cycle' };
      active.add(key);
      if (++links > options.budgets.symlinks) return { bytes, location, trace, issue: 'budget' };
      const name = byteText(target);
      if (name.startsWith('/')) resolved.length = 0;
      pending.unshift(...name.split('/'), { endLink: key });
    } else {
      // readlink's absence is not evidence that the component exists. Native
      // traversal cannot skip an absent component via a later '..'. When stat
      // metadata is supplied, keep failed/unknown traversal advisory and retain
      // the opened spelling rather than inventing a reachable canonical alias.
      // A missing final leaf is still a valid spelling (and normal for writes).
      // Only components required to traverse the remaining suffix need stat.
      if (options.exists && !terminal) {
        try {
          if (await options.exists(Uint8Array.from(path)) !== true) return { bytes, location, trace, issue: 'unresolved' };
        } catch { return { bytes, location, trace, issue: 'unresolved' }; }
      }
      if (options.directory && !terminal) {
        try {
          if (await options.directory(Uint8Array.from(path)) !== true) return { bytes, location, trace, issue: 'unresolved' };
        } catch { return { bytes, location, trace, issue: 'unresolved' }; }
      }
      resolved.push(part);
    }
  }
  return { bytes, location: textBytes('/' + resolved.join('/') + (resolved.length ? suffix : suffix === '/.' ? '.' : '')), trace };
}
