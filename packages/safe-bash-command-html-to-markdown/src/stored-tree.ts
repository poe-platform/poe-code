import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { blockTags, type HtmlEventSink } from "./parser.js";
import type { TextStore } from "./stored-text.js";

const tags = ["unknown", "root", "text", ...blockTags, "em", "i", "strong", "b", "del", "s", "a", "img", "code", "br", "td", "th", "tr", "thead", "tbody", "tfoot"];
const fields = ["parent", "first", "last", "text", "href", "src", "alt", "className", "start", "normalized", "destination"] as const;
type Field = typeof fields[number];
export interface StoredNode extends Record<Field, number> { readonly id: number; readonly tag: string }

/** Fixed-size nodes and linked child entries. The sink retains one current
 * parent offset; ancestors and arbitrarily wide child lists live in storage. */
export class StoredTree {
  constructor(private readonly storage: Pick<PagedStorage, "append" | "read" | "write">, readonly text: TextStore) {}

  async create(tag: string, values: Partial<Record<Field, number>> = {}): Promise<number> {
    const bytes = new Uint8Array(96), view = new DataView(bytes.buffer);
    view.setFloat64(0, Math.max(0, tags.indexOf(tag)), true);
    for (const [index, key] of fields.entries()) view.setFloat64(8 + index * 8, values[key] ?? (key === "destination" ? -1 : 0), true);
    return this.storage.append(bytes);
  }

  async read(id: number): Promise<StoredNode> {
    const bytes = await this.storage.read(id, 96), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const node = { id, tag: tags[view.getFloat64(0, true)]! } as StoredNode;
    for (const [index, key] of fields.entries()) node[key] = view.getFloat64(8 + index * 8, true);
    return node;
  }

  async patch(id: number, values: Partial<Record<Field, number>>): Promise<void> {
    const bytes = new Uint8Array(8), view = new DataView(bytes.buffer);
    for (const [key, value] of Object.entries(values)) {
      view.setFloat64(0, value, true);
      await this.storage.write(id + 8 + fields.indexOf(key as Field) * 8, bytes);
    }
  }

  async append(parent: number, child: number): Promise<void> {
    const node = await this.read(parent), bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
    view.setFloat64(0, child, true); view.setFloat64(8, node.last, true);
    const entry = await this.storage.append(bytes);
    if (node.last) {
      view.setFloat64(0, entry, true);
      await this.storage.write(node.last + 16, bytes.subarray(0, 8));
    }
    await this.patch(parent, { first: node.first || entry, last: entry });
  }

  async *children(parent: number, reverse = false): AsyncGenerator<number> {
    const node = await this.read(parent);
    let entry = reverse ? node.last : node.first;
    while (entry) {
      const bytes = await this.storage.read(entry, 24), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const next = view.getFloat64(reverse ? 8 : 16, true);
      yield view.getFloat64(0, true);
      entry = next;
    }
  }

  async copy(node: StoredNode): Promise<number> {
    const id = await this.create(node.tag, { ...node, first: 0, last: 0 });
    for await (const child of this.children(node.id)) await this.append(id, child);
    if (node.normalized === node.id) await this.patch(id, { normalized: id });
    return id;
  }

  sink(root: number): HtmlEventSink {
    let parent = root;
    return async event => {
      if (event.type === "close") { parent = (await this.read(parent)).parent; return; }
      const values: Partial<Record<Field, number>> = { parent };
      if (event.type === "text") values.text = await this.text.from(event.text);
      else for (const key of ["href", "src", "alt", "class", "start"] as const) {
        const value = event.attributes.get(key);
        if (value) values[key === "class" ? "className" : key] = await this.text.from(value);
      }
      const id = await this.create(event.type === "text" ? "text" : event.tag, values);
      await this.append(parent, id);
      if (event.type === "open") parent = id;
    };
  }
}
