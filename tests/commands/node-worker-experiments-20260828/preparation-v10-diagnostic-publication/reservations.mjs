export class Reservations {
  constructor() {
    this.live = 0;
    this.peak = 0;
    this.entries = new Map();
    this.cumulative = { read: 0, write: 0, output: 0 };
  }

  reserve(key, bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.entries.has(key) || this.live + bytes > 16777216) throw new Error('reservation refused');
    this.entries.set(key, bytes);
    this.live += bytes;
    this.peak = Math.max(this.peak, this.live);
  }

  release(key) {
    if (!this.entries.has(key)) throw new Error('unowned reservation');
    this.live -= this.entries.get(key);
    this.entries.delete(key);
  }

  charge(kind, bytes) {
    const maximum = kind === 'output' ? 1048576 : 4194304;
    if (!Object.hasOwn(this.cumulative, kind) || !Number.isSafeInteger(bytes) || bytes < 0 || this.cumulative[kind] + bytes > maximum) throw new Error('cumulative quota');
    this.cumulative[kind] += bytes;
  }
}
