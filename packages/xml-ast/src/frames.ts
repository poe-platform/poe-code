import type { XmlContent, XmlElement } from './index.js';

export interface XmlParserFrame {
  element: XmlElement;
  content: XmlContent[] | undefined;
  name: string;
  namespaces: Map<string, string>;
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
