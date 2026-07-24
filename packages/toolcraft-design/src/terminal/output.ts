export interface FrameWriter {
  open(): void;
  close(): void;
  writeFrame(ansi: string): void;
}

const OPEN = "\u001b[?1049h\u001b[?25l\u001b[?2004h\u001b[?1000h\u001b[?1006h\u001b[?7l";
const CLOSE = "\u001b[0m\u001b[?7h\u001b[?1006l\u001b[?1000l\u001b[?2004l\u001b[?25h\u001b[?1049l";

export function createFrameWriter(stream: { write(value: string): boolean }): FrameWriter {
  let opened = false;
  const interrupt = () => terminateWith("SIGINT");
  const terminate = () => terminateWith("SIGTERM");
  const fatal = (error: Error) => {
    close();
    throw error;
  };

  function terminateWith(signal: "SIGINT" | "SIGTERM"): void {
    close();
    process.kill(process.pid, signal);
  }

  function open(): void {
    if (opened) return;
    opened = true;
    stream.write(OPEN);
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    process.once("uncaughtException", fatal);
  }

  function close(): void {
    if (!opened) return;
    opened = false;
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    process.removeListener("uncaughtException", fatal);
    stream.write(CLOSE);
  }

  return {
    open,
    close,
    writeFrame(ansi) {
      if (!opened || ansi.length === 0) return;
      stream.write(`\u001b[?2026h${ansi}\u001b[?2026l`);
    }
  };
}
