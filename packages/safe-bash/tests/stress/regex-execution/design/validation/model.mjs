export class RequestQueue {
  active = 0;
  peak = 0;
  trace = [];
  tail = Promise.resolve();
  waiting = 0;
  async run(name, operation) {
    if (this.waiting >= 8) throw new Error('MODEL_QUEUE_CAP');
    this.waiting++;
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    this.waiting--;
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    this.trace.push(`start:${name}`);
    try { return await operation(); }
    finally { this.active--; this.trace.push(`end:${name}`); release(); }
  }
}
