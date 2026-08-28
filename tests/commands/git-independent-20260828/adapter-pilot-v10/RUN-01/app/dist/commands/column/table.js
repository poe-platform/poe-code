import { ColumnBudget } from "./internal.js";
class TailPadding {
    widths;
    separator;
    separatorSize;
    sizes = [];
    next = [];
    separatorBytes;
    constructor(widths, separator, separatorSize) {
        this.widths = widths;
        this.separator = separator;
        this.separatorSize = separatorSize;
    }
    static async create(widths, separator, budget) {
        await budget.work(widths.length);
        const padding = new TailPadding(widths, separator, Buffer.byteLength(separator));
        const last = widths.length - 1;
        padding.sizes[last] = 0;
        padding.next[last] = last;
        for (let index = last - 1; index >= 0; index--) {
            await budget.step();
            const size = widths[index] + padding.separatorSize;
            padding.sizes[index] = Math.min(budget.columnLimits.maxOutputBytes + 1, size + padding.sizes[index + 1]);
            padding.next[index] = size ? index : padding.next[index + 1];
        }
        return padding;
    }
    async emit(row, budget) {
        const start = row.length, last = this.widths.length - 1;
        if (start > last)
            return;
        const gap = this.widths[start - 1] - row[start - 1].width;
        const size = gap + this.separatorSize + this.sizes[start];
        if (!size)
            return;
        budget.checkOutput(size);
        await budget.work(size);
        this.separatorBytes ??= Buffer.from(this.separator);
        let buffer = new Uint8Array(Math.min(size, ColumnBudget.outputChunkBytes)), used = 0;
        const flush = async () => {
            if (!used)
                return;
            await budget.chunk(buffer.subarray(0, used));
            buffer = new Uint8Array(Math.min(size, ColumnBudget.outputChunkBytes));
            used = 0;
        };
        const append = async (count, bytes) => {
            let offset = 0;
            while (offset < count) {
                const length = Math.min(count - offset, buffer.length - used);
                if (bytes)
                    buffer.set(bytes.subarray(offset, offset + length), used);
                else
                    buffer.fill(32, used, used + length);
                offset += length;
                used += length;
                if (used === buffer.length)
                    await flush();
            }
        };
        await append(gap);
        await append(this.separatorSize, this.separatorBytes);
        for (let index = this.next[start]; index < last; index = this.next[index + 1]) {
            await append(this.widths[index]);
            await append(this.separatorSize, this.separatorBytes);
        }
        await flush();
    }
}
export async function tableOutput(rows, widths, separator, budget) {
    if (!rows.length)
        return;
    const padding = await TailPadding.create(widths, separator, budget);
    for (const row of rows) {
        for (let index = 0; index < row.length; index++) {
            const entry = row[index];
            await budget.text(entry.text);
            if (index + 1 < row.length) {
                await budget.padding(widths[index] - entry.width);
                await budget.text(separator);
            }
        }
        await padding.emit(row, budget);
        await budget.text("\n");
    }
}
//# sourceMappingURL=table.js.map