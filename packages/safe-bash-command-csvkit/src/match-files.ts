export interface MatchFile {
  lines(): AsyncIterable<string>;
  close(): Promise<void>;
}

/** Admit opens before dispatch so cleanup also owns in-flight acquisition. */
export class MatchFileScope {
  readonly #admissions: Promise<MatchFile>[] = [];
  #closing: Promise<void> | undefined;
  readonly #closes = new Map<MatchFile, Promise<void>>();
  #closed = false;
  get closed(): boolean { return this.#closed; }
  acquire(factory: () => Promise<MatchFile>): Promise<MatchFile> {
    if (this.#closed) throw new TypeError("match-file scope closed");
    const pending = Promise.resolve().then(factory);
    this.#admissions.push(pending);
    return pending;
  }
  close(file: MatchFile): Promise<void> {
    let closing = this.#closes.get(file);
    if (!closing) { closing = Promise.resolve().then(() => file.close()); this.#closes.set(file, closing); }
    return closing;
  }
  readonly dispose = (): Promise<void> => {
    this.#closed = true;
    this.#closing ??= Promise.allSettled(this.#admissions).then(async admissions => {
      const files = admissions.flatMap(admission => admission.status === "fulfilled" ? [admission.value] : []);
      const results = await Promise.allSettled(files.map(file => this.close(file)));
      const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, "match-file cleanup failed");
    });
    return this.#closing;
  };
}
