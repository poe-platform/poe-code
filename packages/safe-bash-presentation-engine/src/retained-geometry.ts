import { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import type { RetainedPackageContext } from './retained-package.js';
import type { RetainedXmlDocument, RetainedXmlNode } from './retained-xml-document.js';
import { RetainedValues, equal, literal } from './retained-values.js';
import { RetainedOrder } from './retained-order.js';
import { readRetainedPropertyValue } from './retained-property-value.js';
import { streamJson, rawJson } from './retained-output.js';
import { OfficeError } from './errors.js';
import { SelectionError } from './selectors.js';

/** Raw shape lookup matching the buffered reader's preorder and ambiguity rules. */
export async function retainedShapeNode(document: RetainedXmlDocument, id: string, check: () => void) {
  const namespace = () => document.namespace(document.root);
  async function local(node: RetainedXmlNode, names: readonly string[]) { for (const name of names) if (await equal(document.raw(node.localName), literal(name))) return true; return false; }
  for await (const node of document.elements(document.root)) {
    check();
    if (!await equal(document.namespace(node), namespace()) || !await local(node, ['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'])) continue;
    let nonvisual;
    for await (const child of document.children(node)) if (child.kind === 'element' && await equal(document.namespace(child), namespace()) && await local(child, ['nvSpPr', 'nvPicPr', 'nvGraphicFramePr', 'nvCxnSpPr', 'nvGrpSpPr'])) { nonvisual = child; break; }
    if (!nonvisual) continue;
    let properties;
    for await (const child of document.children(nonvisual)) if (child.kind === 'element' && await equal(document.namespace(child), namespace()) && await local(child, ['cNvPr'])) {
      if (properties) throw new OfficeError('invalid-value', 'Ambiguous shared structure.', 'usage'); properties = child;
    }
    if (!properties) throw new OfficeError('unsupported-edit', 'Unsupported shared structure.', 'validate-intent');
    for await (const attr of document.attributes(properties)) if (await equal(document.namespace(attr), literal('')) && await local(attr, ['id']) && await readRetainedPropertyValue('number', document.text(attr), check) === Number(id)) return node;
  }
  throw new SelectionError('missing-selection');
}

/** Stack, child links and attribute sort keys are backed by caller storage.
 * Traversal emits the raw geometry schema without recursive generator chains. */
export async function* retainedGeometry(document: RetainedXmlDocument, root: RetainedXmlNode, settings: RetainedPackageContext): ByteSource {
  const working = settings.workingStorage, signal = settings.signal ?? new AbortController().signal;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, (working.cacheBytes ?? 1024 * 1024) / 16384);
  const check = () => { if (signal.aborted) throw new OfficeError('cancelled', 'Operation cancelled.', 'index'); };
  const values = new RetainedValues(pages, check, signal); let failed = false;
  async function write(pointer: number, numbers: number[]) { const bytes = new Uint8Array(numbers.length * 8), view = new DataView(bytes.buffer); numbers.forEach((value, n) => view.setFloat64(n * 8, value, true)); await pages.write(pointer, bytes); }
  async function row(pointer: number, count: number) { const bytes = await pages.read(pointer, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return Array.from({ length: count }, (_, n) => view.getFloat64(n * 8, true)); }
  const name = (node: RetainedXmlNode) => ({ namespace: () => document.namespace(node), localName: () => document.raw(node.localName) });
  async function* attributeKey(node: RetainedXmlNode) { yield* document.namespace(node); yield* literal('/'); yield* document.raw(node.localName); }
  async function* header(node: RetainedXmlNode): ByteSource {
    yield* literal('{"name":'); yield* streamJson(name(node)); yield* literal(',"attributes":[');
    const order = new RetainedOrder(pages, values, check);
    for await (const attr of document.attributes(node)) { const value = await values.store(streamJson({ name: name(attr), value: () => document.text(attr) })); await order.add(attributeKey(attr), value); }
    await order.seal(); let first = true;
    for await (const value of order.entries()) { if (!first) yield* literal(','); first = false; yield* streamJson({ [rawJson]: () => values.read(value) }); }
    yield* literal('],"children":[');
  }
  async function frame(node: RetainedXmlNode, parent: number) {
    let head = 0, tail = 0;
    for await (const child of document.children(node)) if (child.kind === 'element') { const pointer = pages.allocate(16); await write(pointer, [0, document.reference(child)]); if (tail) await write(tail, [pointer]); else head = pointer; tail = pointer; }
    const pointer = pages.allocate(24); await write(pointer, [parent, head, 0]); return pointer;
  }
  try {
    check(); yield* header(root); let top = await frame(root, 0);
    while (top) {
      check(); const data = await row(top, 3);
      if (!data[1]) { yield* literal(']}'); top = data[0]!; continue; }
      const child = await row(data[1]!, 2); await write(top + 8, [child[0]!, 1]);
      if (data[2]) yield* literal(',');
      const node = await document.node(child[1]!); yield* header(node); top = await frame(node, top);
    }
  } catch (error) { failed = true; throw error; }
  finally { try { await pages.close(); } catch (error) { if (!failed) await Promise.reject(error); } }
}
