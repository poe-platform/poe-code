import type { XmlSourceStep } from './source.js';
import type { XmlContent, XmlElement, XmlName } from './index.js';

export interface XmlParserFrame {
  element: XmlElement;
  content: XmlContent[] | undefined;
  name: string;
  namespaces: Map<string, string>;
  namespaceScope?: XmlNamespaceScope;
}
export type XmlFrameRequest =
  | { readonly frameOperation: 'push'; readonly frame: XmlParserFrame }
  | { readonly frameOperation: 'pop' }
  | { readonly frameOperation: 'peek'; frame?: XmlParserFrame };

/** External mode caches only the current frame. The host owns the linked stack. */
export class XmlFrames {
  private readonly frames: XmlParserFrame[] = [];
  private depth = 0;
  private current: XmlParserFrame | undefined;
  constructor(private readonly external: boolean) {}
  get length(): number { return this.external ? this.depth : this.frames.length; }

  *peek(): Generator<XmlFrameRequest, XmlParserFrame | undefined, void> {
    if (!this.external) return this.frames.at(-1);
    if (!this.depth) return undefined;
    if (!this.current) {
      const request: XmlFrameRequest = { frameOperation: 'peek' };
      yield request;
      if (!request.frame) throw new TypeError('Incomplete XML frame read');
      this.current = request.frame;
    }
    return this.current;
  }
  *push(frame: XmlParserFrame): Generator<XmlFrameRequest, void, void> {
    if (!this.external) { this.frames.push(frame); return; }
    yield { frameOperation: 'push', frame };
    this.current = frame;
    this.depth++;
  }
  *pop(): Generator<XmlFrameRequest, XmlParserFrame | undefined, void> {
    if (!this.external) return this.frames.pop();
    if (!this.depth) return undefined;
    const frame = yield* this.peek();
    yield { frameOperation: 'pop' };
    this.depth--;
    this.current = undefined;
    return frame;
  }
}

/** A host-owned immutable namespace scope; count includes the built-in xml prefix. */
export interface XmlNamespaceScope { readonly reference: number; readonly size: number; }
export type XmlNamespaceRequest =
  | { readonly namespaceOperation: 'reference'; readonly scope: XmlNamespaceScope; readonly prefix: string; reference?: number; complete?: true }
  | { readonly namespaceOperation: 'has'; readonly scope: XmlNamespaceScope; readonly prefix: string; found?: boolean }
  | { readonly namespaceOperation: 'get'; readonly scope: XmlNamespaceScope; readonly prefix: string; value?: string; complete?: true }
  | { readonly namespaceOperation: 'set'; readonly scope: XmlNamespaceScope; readonly prefix: string; readonly value: string | Generator<XmlSourceStep | string, void, void>; result?: XmlNamespaceScope };

export function* namespaceValue(scope: Map<string, string> | XmlNamespaceScope, prefix: string): Generator<XmlNamespaceRequest, string | undefined, void> {
  if (scope instanceof Map) return scope.get(prefix);
  const request: XmlNamespaceRequest = { namespaceOperation: 'get', scope, prefix };
  yield request;
  if (!request.complete) throw new TypeError('Incomplete XML namespace read');
  return request.value;
}

export function* namespaceMetadata(scope: Map<string, string> | XmlNamespaceScope, prefix: string, deferred = false): Generator<XmlNamespaceRequest, Pick<XmlName, 'namespace' | 'namespaceReference'>, void> {
  if (!deferred || scope instanceof Map) return { namespace: (yield* namespaceValue(scope, prefix)) ?? '' };
  if (prefix === 'xml') return { namespace: 'http://www.w3.org/XML/1998/namespace' };
  const request: XmlNamespaceRequest = { namespaceOperation: 'reference', scope, prefix };
  yield request;
  if (!request.complete) throw new TypeError('Incomplete XML namespace reference lookup');
  return { namespace: '', ...(request.reference === undefined ? {} : { namespaceReference: request.reference }) };
}

export function* hasNamespace(scope: Map<string, string> | XmlNamespaceScope, prefix: string): Generator<XmlNamespaceRequest, boolean, void> {
  if (scope instanceof Map) return scope.has(prefix);
  const request: XmlNamespaceRequest = { namespaceOperation: 'has', scope, prefix };
  yield request;
  if (request.found === undefined) throw new TypeError('Incomplete XML namespace membership lookup');
  return request.found;
}

export function* bindNamespace(scope: Map<string, string> | XmlNamespaceScope, prefix: string, value: string | Generator<XmlSourceStep | string, void, void>): Generator<XmlNamespaceRequest, Map<string, string> | XmlNamespaceScope, void> {
  if (scope instanceof Map) {
    if (typeof value !== 'string') throw new TypeError('Streamed XML namespace values require external scopes');
    scope.set(prefix, value); return scope;
  }
  const request: XmlNamespaceRequest = { namespaceOperation: 'set', scope, prefix, value };
  yield request;
  if (!request.result) throw new TypeError('Incomplete XML namespace update');
  return request.result;
}
