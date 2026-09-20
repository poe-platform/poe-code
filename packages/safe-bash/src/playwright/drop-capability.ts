import { PlaywrightResourceLimitError } from './resource-limit.js';
import type { PlaywrightAbility } from './abilities.js';
import { capabilityAction, capabilityLocator, capabilityResult, requireSession } from './capability-result.js';
import { readPlaywrightFiles } from './modal-capabilities.js';
import { sniffMimeType } from '../commands/llm/mime.js';

// Browser globals used only inside the serialized element callback.
declare const DataTransfer: { new(): { setData(type: string, value: string): void; items: { add(file: unknown): void } } };
declare const File: { new(parts: Uint8Array[], name: string, options: { type: string }): unknown };
declare const DragEvent: { new(type: string, options: Record<string, unknown>): unknown };
interface DropElement {
  readonly isConnected: boolean;
  scrollIntoView(options: { block: string; inline: string }): void;
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
  dispatchEvent(event: unknown): boolean;
}

export const playwrightDrop: PlaywrightAbility = {
  scope: 'session', options: 'all',
  limitations: 'Uses synthetic DOM drag events with in-memory files on providers without native drop support.',
  async execute(request) {
    const paths = request.options.path === undefined ? [] : typeof request.options.path === 'string' ? [request.options.path] : request.options.path as readonly string[];
    const entries = request.options.data === undefined ? [] : typeof request.options.data === 'string' ? [request.options.data] : request.options.data as readonly string[];
    if (!paths.length && !entries.length) throw new Error('At least one of "paths" or "data" must be provided.');
    const data: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const entry of entries) {
      const index = entry.indexOf('=');
      if (index === -1) throw new Error(`--data must be in "mime/type=value" format, got: ${entry}`);
      data[entry.slice(0, index)] = entry.slice(index + 1);
    }
    const maximum = request.limits?.maxCommandBytes ?? 1048576;
    let transportBytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
    const files = await readPlaywrightFiles(request, paths);
    // Numeric byte arrays use at most four JSON bytes per byte. Admit before
    // materializing them so browser argument transport cannot grow without bound.
    for (const file of files) transportBytes += file.buffer.byteLength * 4 + new TextEncoder().encode(file.name).byteLength * 6 + 128;
    if (transportBytes > maximum) throw new PlaywrightResourceLimitError('Playwright drop byte limit exceeded');
    const payload = { data, files: files.map(file => ({ name: file.name, mimeType: sniffMimeType(file.name, file.buffer), bytes: Array.from(file.buffer) })) };
    const target = await requireSession(request).resolveTarget(request.args[0]!);
    await capabilityAction(request, async () => {
      await target.evaluate((node, payload) => {
        const element = node as unknown as DropElement;
        const transfer = new DataTransfer();
        for (const [type, value] of Object.entries(payload.data)) transfer.setData(type, value);
        for (const file of payload.files) transfer.items.add(new File([Uint8Array.from(file.bytes)], file.name, { type: file.mimeType }));
        element.scrollIntoView({ block: 'center', inline: 'center' });
        const box = element.getBoundingClientRect();
        if (!element.isConnected || !box.width || !box.height) throw new Error('Drop target is not visible');
        for (const type of ['dragenter', 'dragover', 'drop']) element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
      }, payload);
    });
    return capabilityResult(`await ${capabilityLocator(request.args[0]!, request)}.drop(${JSON.stringify({ ...(paths.length ? { files: paths } : {}), ...(entries.length ? { data } : {}) })});`);
  },
};
