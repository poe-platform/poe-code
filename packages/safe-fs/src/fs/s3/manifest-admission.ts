import { FsError } from '../../contracts/errors.js';
import { readBytes, type ByteSource } from '../../contracts/io.js';

type Shape = 'namespace' | 'nodes' | 'node' | 'bytes';
type State = 'keyOrEnd' | 'key' | 'colon' | 'valueOrEnd' | 'value' | 'commaOrEnd';
interface Frame {
  shape: Shape;
  state: State;
  key: string;
  keys: Set<string>;
}

/** Admit the fixed manifest grammar before JSON.parse can allocate its graph. */
export async function* admitManifest(source: ByteSource, options: {
  maxManifestBytes: number;
  maxEntries: number;
  maxBytes: number;
  signal?: AbortSignal | undefined;
}): ByteSource {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const frames: Frame[] = [];
  let started = false;
  let done = false;
  let token = '';
  let quoted = false;
  let escaped = false;
  let entries = 0;
  let bytes = 0;
  let wireBytes = 0;
  let allocation = 0;
  // Conservative accounting for graph storage, array growth, and validation
  // tables. This is an admission estimate, not a process-RSS guarantee.
  const allocationLimit = options.maxManifestBytes * 4;
  const invalid = (): never => { throw new FsError('EIO', { message: 'Invalid S3 namespace structure' }); };
  const reserve = (amount: number) => {
    if (amount > allocationLimit - allocation) throw new FsError('EFBIG', { message: 'S3 namespace graph exceeds allocation budget' });
    allocation += amount;
  };
  const open = (shape: Shape) => {
    reserve(256);
    frames.push({ shape, state: shape === 'bytes' ? 'valueOrEnd' : 'keyOrEnd', key: '', keys: new Set() });
  };
  const scalar = () => {
    const frame = frames.at(-1) ?? invalid();
    let value: unknown;
    try { value = JSON.parse(token); } catch { invalid(); }
    token = '';
    if (frame.state === 'key' || frame.state === 'keyOrEnd') {
      if (typeof value !== 'string' || frame.keys.has(value)) invalid();
      const key = value as string;
      if (frame.shape === 'nodes') {
        if (key.length > 4096) invalid();
        if (++entries > options.maxEntries) throw new FsError('ENOSPC');
      } else {
        const fields = frame.shape === 'namespace' ? ['version', 'identity', 'nextInode', 'nodes']
          : ['ino', 'revision', 'type', 'mode', 'time', 'bytes'];
        if (!fields.includes(key)) invalid();
      }
      reserve(64 + key.length * 2);
      frame.keys.add(key);
      frame.key = key;
      frame.state = 'colon';
      return;
    }
    if (frame.state !== 'value' && frame.state !== 'valueOrEnd') invalid();
    if (frame.shape === 'bytes') {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 255) invalid();
      if (++bytes > options.maxBytes) throw new FsError('ENOSPC');
      reserve(16);
    } else if (frame.shape === 'nodes' || frame.key === 'nodes' || frame.key === 'bytes') invalid();
    else if (frame.key === 'identity' || frame.key === 'type') {
      if (typeof value !== 'string' || (frame.key === 'identity' ? value.length < 1 || value.length > 128 : !['file', 'directory'].includes(value))) invalid();
      reserve((value as string).length * 2);
    } else if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
    frame.state = 'commaOrEnd';
  };
  const feed = (text: string) => {
    for (const character of text) {
      if (token) {
        if (quoted) {
          token += character;
          if (token.length > 4096 * 6 + 2) invalid();
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') { quoted = false; scalar(); }
          continue;
        }
        if (![' ', '\n', '\r', '\t', ',', '}', ']'].includes(character)) {
          if (token.length >= 64) invalid();
          token += character;
          continue;
        }
        scalar();
      }
      if ([' ', '\n', '\r', '\t'].includes(character)) continue;
      if (done) invalid();
      if (!started) {
        if (character !== '{') invalid();
        started = true;
        open('namespace');
        continue;
      }
      const frame = frames.at(-1) ?? invalid();
      if (character === '}' || character === ']') {
        if ((character === ']') !== (frame.shape === 'bytes')
          || !['commaOrEnd', 'keyOrEnd', 'valueOrEnd'].includes(frame.state)) invalid();
        if (frame.shape === 'namespace' && frame.keys.size !== 4 || frame.shape === 'node' && frame.keys.size !== 6) invalid();
        frames.pop();
        if (!frames.length) done = true;
        continue;
      }
      if (frame.state === 'commaOrEnd') {
        if (character !== ',') invalid();
        frame.state = frame.shape === 'bytes' ? 'value' : 'key';
        continue;
      }
      if (frame.state === 'colon') {
        if (character !== ':') invalid();
        frame.state = 'value';
        continue;
      }
      if (frame.state === 'key' || frame.state === 'keyOrEnd') {
        if (character !== '"') invalid();
      } else if (character === '{' || character === '[') {
        const shape = frame.shape === 'namespace' && frame.key === 'nodes' ? 'nodes'
          : frame.shape === 'nodes' ? 'node' : frame.shape === 'node' && frame.key === 'bytes' ? 'bytes' : invalid();
        if ((character === '[') !== (shape === 'bytes')) invalid();
        frame.state = 'commaOrEnd';
        open(shape);
        continue;
      } else if (frame.shape === 'nodes' || frame.key === 'nodes' || frame.key === 'bytes') invalid();
      quoted = character === '"';
      escaped = false;
      token = character;
    }
  };
  for await (const chunk of readBytes(source, options.signal)) {
    if (chunk.byteLength > options.maxManifestBytes - wireBytes) throw new FsError('EFBIG');
    wireBytes += chunk.byteLength;
    feed(decoder.decode(chunk, { stream: true }));
    yield chunk;
  }
  feed(decoder.decode());
  if (!done || token || frames.length) invalid();
}
