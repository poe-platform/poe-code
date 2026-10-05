import type { XmlNamespaceScope } from "./frames.js";
export interface XmlAttributeRecord { name: string; prefix: string; localName: string; value: string; next: number; source?: { start: number; end: number }; }
export interface XmlAttributeState { reference: number; first: number; length: number; size: number; }
export type XmlAttributeRequest =
  | { attributeOperation: 'has' | 'expanded'; state: XmlAttributeState; name: string; found?: boolean; namespace?: { scope: XmlNamespaceScope; prefix: string } }
  | { attributeOperation: 'append'; state: XmlAttributeState; attribute: Omit<XmlAttributeRecord, 'next'>; result?: XmlAttributeState }
  | { attributeOperation: 'read'; state: XmlAttributeState; reference: number; values: boolean; result?: XmlAttributeRecord };

/** Buffered APIs use local collections; external parsing retains only a store
 * handle and one current attribute. Hosts preserve order and last-value recovery. */
export class XmlAttributes {
  private state: XmlAttributeState = { reference: 0, first: 0, length: 0, size: 0 };
  private readonly names = new Map<string, string>();
  private readonly records: Omit<XmlAttributeRecord, 'next' | 'value'>[] = [];
  private readonly expandedNames = new Set<string>();
  constructor(private readonly external: boolean) {}
  get length(): number { return this.state.length; }
  get size(): number { return this.state.size; }
  get first(): number { return this.state.first; }

  *has(name: string): Generator<XmlAttributeRequest, boolean, void> {
    if (!this.length) return false;
    if (!this.external) return this.names.has(name);
    const request: XmlAttributeRequest = { attributeOperation: 'has', state: this.state, name };
    yield request;
    if (request.found === undefined) throw new TypeError('Incomplete XML attribute lookup');
    return request.found;
  }

  *append(name: string, prefix: string, localName: string, value: string, source?: { start: number; end: number }): Generator<XmlAttributeRequest, void, void> {
    if (!this.external) {
      this.names.set(name, value); this.records.push({ name, prefix, localName });
      this.state = { reference: 0, first: 1, length: this.records.length, size: this.names.size };
      return;
    }
    const request: XmlAttributeRequest = { attributeOperation: 'append', state: this.state, attribute: { name, prefix, localName, value, ...(source ? { source } : {}) } };
    yield request;
    if (!request.result) throw new TypeError('Incomplete XML attribute append');
    this.state = request.result;
  }

  *read(reference: number, values: boolean): Generator<XmlAttributeRequest, XmlAttributeRecord, void> {
    if (!this.external) {
      const attribute = this.records[reference - 1]!;
      return { ...attribute, value: values ? this.names.get(attribute.name)! : '', next: reference < this.length ? reference + 1 : 0 };
    }
    const request: XmlAttributeRequest = { attributeOperation: 'read', state: this.state, reference, values };
    yield request;
    if (!request.result) throw new TypeError('Incomplete XML attribute read');
    return request.result;
  }

  *expanded(name: string, namespace?: { scope: XmlNamespaceScope; prefix: string }): Generator<XmlAttributeRequest, boolean, void> {
    if (!this.external) {
      const found = this.expandedNames.has(name); this.expandedNames.add(name); return found;
    }
    const request: XmlAttributeRequest = { attributeOperation: 'expanded', state: this.state, name, ...(namespace ? { namespace } : {}) };
    yield request;
    if (request.found === undefined) throw new TypeError('Incomplete XML expanded attribute lookup');
    return request.found;
  }
}
