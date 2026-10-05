import type {PagedStorage} from "safe-bash-io-engine/storage";
import type {SourceRange} from "./retained-source-text.js";

const types = ["alias", "anchor", "block-map", "block-scalar", "block-scalar-header", "block-seq", "byte-order-mark", "comma", "comment", "directive", "directive-line", "doc-end", "doc-mode", "doc-start", "document", "double-quoted-scalar", "explicit-key-ind", "flow-collection", "flow-error-end", "flow-map-end", "flow-map-start", "flow-seq-end", "flow-seq-start", "map-value-ind", "newline", "scalar", "seq-item-ind", "single-quoted-scalar", "space", "tag"] as const;
export type YamlCstType = typeof types[number];
export interface YamlCstNode {
  type?: YamlCstType;
  offset?: number;
  indent?: number;
  source?: SourceRange | "\x02" | "\x18" | "\x1f";
  start?: number;
  end?: number;
  items?: number;
  props?: number;
  sep?: number;
  key?: number;
  value?: number;
  explicitKey?: boolean;
}
const fields = ["offset", "indent", "start", "end", "items", "props", "sep", "key", "value"] as const;

/** Fixed-size CST records and doubly linked lists in caller storage. Snapshots
 * contain only scalar fields and references, never child objects or source text.
 * Missing fields remain distinct from empty lists and explicit null keys (-1). */
export class RetainedYamlCst {
  constructor(private readonly storage: PagedStorage, private readonly cooperate: (units?: number) => Promise<void>) {}
  private async read(position: number, count: number): Promise<number[]> {
    await this.cooperate();
    const bytes = await this.storage.read(position, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({length: count}, (_, index) => view.getFloat64(index * 8, true));
  }
  private async write(position: number, values: readonly number[]): Promise<void> {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat64(index * 8, value, true));
    await this.storage.write(position, bytes); await this.cooperate();
  }
  async create(node: YamlCstNode): Promise<number> {
    const position = this.storage.allocate(104); await this.put(position, node); return position;
  }
  async put(position: number, node: YamlCstNode): Promise<void> {
    await this.write(position, [node.type === undefined ? -1 : types.indexOf(node.type), ...fields.map(key => node[key] ?? NaN),
      typeof node.source === "string" ? -node.source.charCodeAt(0) : node.source?.start ?? NaN, typeof node.source === "string" ? -node.source.charCodeAt(0) : node.source?.end ?? NaN, node.explicitKey === undefined ? NaN : Number(node.explicitKey)]);
  }
  async get(position: number): Promise<YamlCstNode> {
    const values = await this.read(position, 13), node: YamlCstNode = {};
    if (values[0]! >= 0) node.type = types[values[0]!]!;
    fields.forEach((key, index) => {if (!Number.isNaN(values[index + 1]!)) node[key] = values[index + 1]!;});
    if (!Number.isNaN(values[10]!)) node.source = values[10]! < 0 ? String.fromCharCode(-values[10]!) as "\x02" | "\x18" | "\x1f" : {start: values[10]!, end: values[11]!};
    if (!Number.isNaN(values[12]!)) node.explicitKey = !!values[12];
    return node;
  }
  async list(...values: number[]): Promise<number> {
    const position = this.storage.allocate(24); await this.write(position, [0, 0, 0]);
    for (const value of values) await this.push(position, value);
    return position;
  }
  async count(list: number): Promise<number> {return (await this.read(list + 16, 1))[0]!;}
  async push(list: number, value: number): Promise<void> {
    const [first, last, count] = await this.read(list, 3), link = this.storage.allocate(24);
    await this.write(link, [last!, 0, value]);
    if (last) await this.write(last + 8, [link]);
    await this.write(list, [first || link, link, count! + 1]);
  }
  async pop(list: number): Promise<number | undefined> {
    const [first, last, count] = await this.read(list, 3);
    if (!last) return;
    const [previous, , value] = await this.read(last, 3);
    if (previous) await this.write(previous + 8, [0]);
    await this.write(list, [previous ? first! : 0, previous!, count! - 1]);
    return value;
  }
  private async link(list: number, index: number): Promise<number> {
    const [first, last, count] = await this.read(list, 3);
    if (index < 0) index += count!;
    if (index < 0 || index >= count!) return 0;
    let link = index < count! / 2 ? first! : last!;
    if (index < count! / 2) while (index--) link = (await this.read(link + 8, 1))[0]!;
    else for (let i = count! - 1; i > index; i--) link = (await this.read(link, 1))[0]!;
    return link;
  }
  async at(list: number, index: number): Promise<number | undefined> {
    const link = await this.link(list, index); return link ? (await this.read(link + 16, 1))[0] : undefined;
  }
  async set(list: number, index: number, value: number): Promise<void> {
    const link = await this.link(list, index);
    if (!link) throw new RangeError("YAML CST list index out of range");
    await this.write(link + 16, [value]);
  }
  async *values(list: number): AsyncGenerator<number> {
    let link = (await this.read(list, 1))[0]!;
    while (link) {const [, next, value] = await this.read(link, 3); yield value!; link = next!;}
  }
  async append(target: number, source: number): Promise<void> {
    // Capture the count so even self-concatenation has finite copy semantics.
    let remaining = await this.count(source);
    for await (const value of this.values(source)) {if (!remaining--) break; await this.push(target, value);}
  }
  async split(list: number, index: number): Promise<number> {
    const [first, last, count] = await this.read(list, 3);
    index = Math.max(0, Math.min(count!, index < 0 ? count! + index : index));
    const result = await this.list();
    if (index === count) return result;
    const link = (await this.link(list, index)), previous = (await this.read(link, 1))[0]!;
    if (previous) await this.write(previous + 8, [0]);
    await this.write(link, [0]);
    await this.write(list, [index ? first! : 0, previous, index]);
    await this.write(result, [link, last!, count! - index]);
    return result;
  }
}
