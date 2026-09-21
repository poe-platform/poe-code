// Released Gnumeric 1.12.61 plugins/lotus-123/lotus.c; GPL-2.0-or-later.
import { SsconvertError } from "../contracts.js";
export interface LotusRun {
  readonly dimensions: number;
  repeat: number;
  remaining: number;
  readonly children: LotusRun[];
  data?: Uint8Array;
}
export class LotusRldb {
  readonly root: LotusRun;
  private pending = 0;
  private readonly definitions = new Map<number, LotusRun>();
  constructor(private readonly sizes: readonly number[], private readonly charge: () => void) {
    this.root = this.node(sizes.length);
  }
  private node(dimensions: number): LotusRun {
    this.charge();
    return { dimensions, repeat: 0, remaining: dimensions ? this.sizes[this.sizes.length - dimensions]! : 0, children: [] };
  }
  private open(node: LotusRun): LotusRun | undefined {
    const last = node.children.at(-1);
    return last?.remaining ? last : undefined;
  }
  async repeat(value: number, warn: (message: string) => Promise<unknown>, node = this.root): Promise<void> {
    this.charge();
    if (value <= 0 || !node.dimensions) throw new SsconvertError("io", "Error while reading lotus workbook.");
    let child = this.open(node);
    if (child) await this.repeat(value, warn, child);
    else {
      if (value > node.remaining) { await warn(`Got rll of ${value} when only ${node.remaining} left.`); value = node.remaining; }
      child = this.node(node.dimensions - 1); child.repeat = value; node.children.push(child);
      if (this.pending) { this.definitions.set(this.pending, child); this.pending = 0; }
    }
    if (!child.remaining) node.remaining -= child.repeat;
  }
  register(id: number): void {
    this.charge();
    if (!id || this.pending) throw new SsconvertError("io", "Error while reading lotus workbook.");
    this.pending = id;
  }
  use(id: number, node = this.root): void {
    this.charge();
    let child = this.open(node);
    if (child) this.use(id, child);
    else {
      child = this.definitions.get(id);
      if (!child || child.remaining || child.dimensions !== node.dimensions - 1)
        throw new SsconvertError("io", "Error while reading lotus workbook.");
      node.children.push(child);
    }
    if (!child.remaining) node.remaining -= child.repeat;
  }
  data(bytes: Uint8Array): void {
    this.charge();
    if (this.pending) throw new SsconvertError("io", "Error while reading lotus workbook.");
    let node = this.root;
    while (node.dimensions) {
      const child = node.children.at(-1);
      if (!child) throw new SsconvertError("io", "Error while reading lotus workbook.");
      node = child;
    }
    if (node.data) throw new SsconvertError("io", "Error while reading lotus workbook.");
    node.data = bytes;
  }
}
