import type { XmlElement, XmlFrameRequest, XmlNamespaceScope } from '@poe-code/safe-fs/core';
import type { PagedStorage } from '@poe-code/safe-fs/storage';

type FrameRecord = {
  name: string;
  element: Omit<XmlElement, 'namespaces'>;
  namespaces: [string, string][];
  retainNamespaces: boolean;
  namespaceScope?: XmlNamespaceScope;
};

/** Linked parser frames share the source cache; no array grows with nesting depth. */
export class StoredXmlFrames {
  private head = 0;
  constructor(private readonly storage: PagedStorage) {}

  async execute(request: XmlFrameRequest): Promise<void> {
    if (request.frameOperation === 'push') {
      const frame = request.frame;
      const { namespaces, ...element } = frame.element;
      const record: FrameRecord = { name: frame.name, element, namespaces: [...frame.namespaces],
        retainNamespaces: namespaces === frame.namespaces, ...(frame.namespaceScope ? { namespaceScope: frame.namespaceScope } : {}) };
      const source = JSON.stringify(record);
      const reference = this.storage.allocate(16 + source.length * 2);
      const header = new Uint8Array(16), view = new DataView(header.buffer);
      view.setFloat64(0, this.head, true); view.setFloat64(8, source.length, true);
      await this.storage.write(reference, header);
      for (let index = 0; index < source.length; index += 4096) {
        const length = Math.min(4096, source.length - index);
        const bytes = new Uint8Array(length * 2), data = new DataView(bytes.buffer);
        for (let offset = 0; offset < length; offset++) data.setUint16(offset * 2, source.charCodeAt(index + offset), true);
        await this.storage.write(reference + 16 + index * 2, bytes);
      }
      this.head = reference;
      return;
    }
    if (!this.head) throw new TypeError('Empty XML frame store');
    const header = await this.storage.read(this.head, 16), view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (request.frameOperation === 'pop') { this.head = view.getFloat64(0, true); return; }
    const length = view.getFloat64(8, true);
    let source = '';
    for (let index = 0; index < length; index += 4096) {
      const count = Math.min(4096, length - index);
      const bytes = await this.storage.read(this.head + 16 + index * 2, count * 2);
      const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), units = new Uint16Array(count);
      for (let offset = 0; offset < count; offset++) units[offset] = data.getUint16(offset * 2, true);
      source += String.fromCharCode(...units);
    }
    const record = JSON.parse(source) as FrameRecord;
    const namespaces = new Map(record.namespaces);
    request.frame = { name: record.name, namespaces, content: undefined, ...(record.namespaceScope ? { namespaceScope: record.namespaceScope } : {}),
      element: { ...record.element, namespaces: record.retainNamespaces ? namespaces : new Map() } };
  }
}
