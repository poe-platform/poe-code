interface Frame {
  data: string;
  bytes: number;
  resolve(): void;
  reject(error: unknown): void;
}

interface ActiveWrite {
  frame: Frame;
  completed: boolean;
  returned: boolean;
  drained: boolean;
  needsDrain: boolean;
}

/** One connection's admitted frames, including its submitted, unsettled write. */
export class StdioOutput {
  private readonly queue: Frame[] = [];
  private active: ActiveWrite | undefined;
  private bytes = 0;
  private stopped = false;
  private failure: unknown;
  private awaitingError = false;

  constructor(
    private readonly writable: NodeJS.WritableStream,
    private readonly maxBytes: number,
    private readonly onFailure: (error: unknown) => void,
    private readonly onIdle: () => void
  ) {
    writable.on("drain", this.onDrain);
    writable.on("error", this.onError);
    writable.on("close", this.onClose);
  }

  get pending(): number { return this.queue.length + (this.active === undefined ? 0 : 1); }

  write(data: string): Promise<void> {
    if (this.stopped) return Promise.reject(this.failure);
    const bytes = Buffer.byteLength(data);
    if (bytes > this.maxBytes - this.bytes) {
      const error = new Error("Stdio output byte limit exceeded");
      this.abort(error);
      return Promise.reject(error);
    }
    this.bytes += bytes;
    const promise = new Promise<void>((resolve, reject) => {
      this.queue.push({ data, bytes, resolve, reject });
    });
    this.pump();
    return promise;
  }

  abort(error: unknown): void {
    if (!this.stopped) {
      this.stopped = true;
      this.failure = error;
      this.active?.frame.reject(error);
      if (this.active?.completed) this.active = undefined;
      for (const frame of this.queue.splice(0)) frame.reject(error);
      this.bytes = 0;
      this.onFailure(error);
    }
    // A submitted write can still fail after connection settlement. Keep its
    // observation until callback/error/close; never destroy a caller's stream.
    if (this.active === undefined && !this.awaitingError) this.detach();
  }

  close(): void {
    this.stopped = true;
    this.failure = new Error("Stdio output is closed");
    this.detach();
  }

  private pump(): void {
    if (this.stopped || this.active !== undefined) return;
    const frame = this.queue.shift();
    if (frame === undefined) {
      this.onIdle();
      return;
    }
    const active: ActiveWrite = { frame, completed: false, returned: false, drained: false, needsDrain: false };
    this.active = active;
    try {
      const accepted = this.writable.write(frame.data, "utf8", (error?: Error | null) => {
        if (error != null) {
          this.awaitingError = true;
          this.active = undefined;
          frame.reject(error);
          this.abort(error);
          return;
        }
        active.completed = true;
        if (this.stopped) {
          this.active = undefined;
          this.detach();
        } else {
          this.advance();
        }
      });
      active.returned = true;
      active.needsDrain = !accepted;
      this.advance();
    } catch (error) {
      this.active = undefined;
      frame.reject(error);
      this.abort(error);
    }
  }

  private advance(): void {
    const active = this.active;
    if (this.stopped || active === undefined || !active.returned || !active.completed ||
      (active.needsDrain && !active.drained)) return;
    this.active = undefined;
    this.bytes -= active.frame.bytes;
    active.frame.resolve();
    this.pump();
  }

  private readonly onDrain = (): void => {
    if (this.active !== undefined) this.active.drained = true;
    this.advance();
  };

  private readonly onError = (error: unknown): void => {
    this.awaitingError = false;
    this.abort(error);
    this.active = undefined;
    this.detach();
  };

  private readonly onClose = (): void => {
    this.awaitingError = false;
    this.abort(new Error("Stdio output closed before connection completion"));
    this.active = undefined;
    this.detach();
  };

  private detach(): void {
    this.writable.off("drain", this.onDrain);
    this.writable.off("error", this.onError);
    this.writable.off("close", this.onClose);
  }
}
