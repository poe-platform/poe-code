import type { PlaywrightElementHandle } from './adapter.js';

export async function capturePlaywrightTargetScreenshot(target: PlaywrightElementHandle, options: {
  readonly type: 'png' | 'jpeg';
  readonly scale: 'css' | 'device';
  readonly timeout: number;
  readonly maxArtifactBytes: number;
  readonly signal: AbortSignal;
}): Promise<Uint8Array> {
  options.signal.throwIfAborted();
  if (!target.screenshot || !target.boundingBox) throw new Error('Element screenshots are unavailable in this browser');
  const box = await target.boundingBox();
  options.signal.throwIfAborted();
  const ratio = options.scale === 'device' ? await target.evaluate(node => {
    const view = node.ownerDocument?.defaultView as { devicePixelRatio?: number } | undefined;
    return view?.devicePixelRatio ?? 1;
  }) : 1;
  if (!box || !Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) throw new Error('Invalid screenshot dimensions');
  const block = options.type === 'jpeg' ? 8 : 1;
  const width = Math.ceil(box.width * ratio / block) * block;
  const height = Math.ceil(box.height * ratio / block) * block;
  const maxPixels = Math.min(Math.floor(options.maxArtifactBytes / 4), options.type === 'jpeg' ? 1_000_000 : 4_000_000);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > Math.floor(maxPixels / height)) throw new PlaywrightResourceLimitError('Screenshot pixel limit exceeded');
  const bytes = await target.screenshot({ type: options.type, ...(options.type === 'jpeg' ? { quality: 90 } : {}), scale: options.scale, timeout: options.timeout });
  options.signal.throwIfAborted();
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Screenshot must return bytes');
  if (bytes.byteLength > options.maxArtifactBytes) throw new PlaywrightResourceLimitError('Artifact byte limit exceeded');
  return new Uint8Array(bytes);
}
import { PlaywrightResourceLimitError } from './resource-limit.js';
