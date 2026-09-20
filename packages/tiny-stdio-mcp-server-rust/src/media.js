import { createRequire } from "node:module";

const native = createRequire(import.meta.url)("./tiny-stdio-mcp-server-rust.node");
export const { fileTypeFromBuffer } = native;
const helpers = new WeakMap();
const construction = Symbol("media construction");

class ContentHelper {
  toContentBlock() {
    const stored = helpers.get(this);
    if (stored === undefined) throw new TypeError("Invalid content helper");
    if (stored.kind === "bytes") return native.fileBytes(stored.data, stored.mime);
    if (stored.kind === "text") return native.fileText(stored.data, stored.mime);
    return { ...stored.block };
  }
}

class BinaryMedia extends ContentHelper {
  constructor(token, block) {
    super();
    if (token !== construction) throw new TypeError("Use a content helper factory");
    helpers.set(this, { kind: "block", block });
  }
  static fromBytes(data, format) {
    return new this(construction, native.mediaBytes(this.kind, data, format));
  }
  static fromBase64(base64, mimeType) {
    return new this(construction, native.mediaBase64(this.kind, base64, mimeType));
  }
}

export class Image extends BinaryMedia {
  static kind = "image";
}
export class Audio extends BinaryMedia {
  static kind = "audio";
}
export class File extends ContentHelper {
  constructor(token, stored) {
    super();
    if (token !== construction) throw new TypeError("Use a content helper factory");
    helpers.set(this, stored);
  }
  static fromBytes(data, mimeType) {
    return new File(construction, { kind: "bytes", data, mime: mimeType });
  }
  static fromText(text, mimeType = "text/plain") {
    return new File(construction, { kind: "text", data: text, mime: mimeType });
  }
  static fromBase64(base64, mimeType) {
    return new File(construction, { kind: "bytes", data: native.decodeMediaBase64(base64), mime: mimeType });
  }
}

// Replace only branded helpers in tool-return array positions. Descriptor
// copying preserves holes/accessors/cycles for native ingress to reject safely.
export function prepareToolValue(value) {
  if (helpers.has(value)) return ContentHelper.prototype.toContentBlock.call(value);
  if (!Array.isArray(value)) return value;
  const copies = new Map();
  const pending = [{ source: value, depth: 0 }];
  let entries = 0;
  let hasHelpers = false;
  while (pending.length > 0) {
    const { source, depth } = pending.pop();
    if (depth > 256) return value;
    if (copies.has(source)) continue;
    entries += source.length;
    if (entries > 100_000) return value;
    copies.set(source, null);
    for (let index = 0; index < source.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
      if (descriptor && "value" in descriptor) {
        if (helpers.has(descriptor.value)) hasHelpers = true;
        else if (Array.isArray(descriptor.value))
          pending.push({ source: descriptor.value, depth: depth + 1 });
      }
    }
  }
  if (!hasHelpers) return value;
  for (const source of copies.keys()) {
    const copy = new Array(source.length);
    Object.setPrototypeOf(copy, Object.getPrototypeOf(source));
    const hook = Object.getOwnPropertyDescriptor(source, "toJSON");
    if (hook !== undefined) Object.defineProperty(copy, "toJSON", hook);
    copies.set(source, copy);
  }
  for (const [source, copy] of copies) {
    for (let index = 0; index < source.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
      if (descriptor === undefined) continue;
      if ("value" in descriptor) {
        if (helpers.has(descriptor.value))
          descriptor.value = ContentHelper.prototype.toContentBlock.call(descriptor.value);
        else if (copies.has(descriptor.value)) descriptor.value = copies.get(descriptor.value);
      }
      Object.defineProperty(copy, index, descriptor);
    }
  }
  return copies.get(value);
}
