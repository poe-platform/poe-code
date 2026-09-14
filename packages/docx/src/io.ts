import { archiveSettings, CancellationError, InputTypeError, ResourceLimitError, type ArchiveContext, type DocumentArchive } from "./archive.js";
import { readDocumentArchive, type AdmittedDocumentArchive } from "./admission.js";
import { SinkError, type ArchiveSink, type ArchiveWriteOptions } from "./archive-write.js";
import { writeDocumentArchive } from "./document-write.js";

export interface DocumentByteSource {
  open(signal: AbortSignal): AsyncIterable<Uint8Array>;
}

export interface DocumentIoContext extends ArchiveContext {
  readonly registerCleanup?: (cleanup: () => Promise<void>) => void;
}

/** Owns admitted cooperative source iterations and awaited sink operations. */
export class DocumentIo {
  readonly #controller = new AbortController();
  readonly #borrowed: AbortSignal;
  readonly #context: ArchiveContext;
  readonly #pending = new Set<Promise<unknown>>();
  #closed = false;
  #completion?: Promise<void>;

  constructor(context: DocumentIoContext) {
    const { limits, signal, budget } = archiveSettings(context);
    this.#borrowed = signal;
    this.#context = { limits, signal: AbortSignal.any([signal, this.#controller.signal]), budget };
    context.registerCleanup?.(this.cleanup);
  }

  readonly cleanup = (): Promise<void> => {
    if (this.#completion) return this.#completion;
    this.#closed = true;
    // Publish the shared completion before abort listeners can reenter cleanup.
    let complete!: () => void;
    this.#completion = new Promise<void>(resolve => { complete = resolve; });
    const admitted = [...this.#pending];
    this.#controller.abort(new CancellationError("Document I/O closed."));
    void Promise.allSettled(admitted).then(() => { complete(); });
    return this.#completion;
  };

  #check(): void {
    if (this.#context.signal.aborted || this.#closed)
      throw new CancellationError("Document I/O cancelled.", {
        cause: this.#borrowed.aborted ? this.#borrowed.reason : this.#controller.signal.reason
      });
  }

  #run<T>(operation: () => Promise<T>): Promise<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const pending = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    this.#pending.add(pending);
    // Both outcomes are observed even if a host stops awaiting an operation.
    void pending.then(() => { this.#pending.delete(pending); }, () => { this.#pending.delete(pending); });
    try {
      this.#check();
      void operation().then(value => {
        try { this.#check(); resolve(value); } catch (error) { reject(error); }
      }, error => {
        if (this.#borrowed.aborted || (this.#controller.signal.aborted && error instanceof CancellationError)) {
          try { this.#check(); } catch (cancelled) { reject(cancelled); }
        } else reject(error);
      });
    } catch (error) { reject(error); }
    return pending;
  }

  read(source: DocumentByteSource): Promise<AdmittedDocumentArchive> {
    return this.#run(async () => {
      if (!source || typeof source.open !== "function") throw new InputTypeError("Expected a document byte source.");
      const { limits, signal, budget } = archiveSettings(this.#context);
      const chunks: Uint8Array[] = [];
      let size = 0;
      const iterator = source.open(signal)[Symbol.asyncIterator]();
      let exhausted = false;
      let failed = false;
      let failure: unknown;
      try {
        while (true) {
          this.#check();
          const item = await iterator.next();
          this.#check();
          if (item.done) { exhausted = true; break; }
          const bytes = item.value;
          if (!(bytes instanceof Uint8Array)) throw new InputTypeError("Expected source byte chunks.");
          if (bytes.length > limits.maxArchiveBytes - size)
            throw new ResourceLimitError("Document input byte limit exceeded.");
          budget.check("work", budget.usage.work + bytes.length + 1);
          // Reserve owned/contiguous bytes and conservative fragment bookkeeping.
          budget.charge("retainedBytes", bytes.length ? bytes.length * 2 + 64 : 0);
          size += bytes.length;
          if (bytes.length) chunks.push(new Uint8Array(bytes));
          await budget.checkpoint(bytes.length + 1);
        }
      } catch (error) { failed = true; failure = error; }
      finally {
        if (!exhausted && iterator.return) {
          try { await iterator.return(); } catch (error) {
            if (!failed) { failed = true; failure = error; }
          }
        }
      }
      if (failed) throw failure;
      this.#check();
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return readDocumentArchive(bytes, { limits, signal, budget });
    });
  }

  write(archive: DocumentArchive, sink: ArchiveSink, options: ArchiveWriteOptions): Promise<void> {
    return this.#run(async () => {
      if (!sink || typeof sink.write !== "function") throw new InputTypeError("Expected a document byte sink.");
      let sinkFailure: SinkError | undefined;
      try {
        await writeDocumentArchive(archive, { write: async (bytes, signal) => {
          try { await sink.write(bytes, signal); }
          catch (error) {
            if (!(error instanceof CancellationError))
              sinkFailure = new SinkError("Document output failed.", { cause: error });
            throw error;
          }
        } }, options, this.#context);
      } catch (error) { throw sinkFailure ?? error; }
    });
  }
}
