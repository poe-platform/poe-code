export type TerminalInputEvent =
  | { type: "key"; name: string; ch?: string; ctrl: boolean; alt: boolean; shift: boolean }
  | { type: "paste"; text: string }
  | { type: "wheel"; direction: "up" | "down"; x: number; y: number };

export interface InputParser {
  feed(chunk: Buffer): TerminalInputEvent[];
  flush(): TerminalInputEvent[];
  destroy(): void;
}

const ESC = 0x1b;
const PASTE_START = Buffer.from("\u001b[200~");
const PASTE_END = Buffer.from("\u001b[201~");

export function createInputParser(options: { escTimeoutMs?: number; onEvent?: (event: TerminalInputEvent) => void } = {}): InputParser {
  const escTimeoutMs = options.escTimeoutMs ?? 50;
  let pending = Buffer.alloc(0);
  let paste = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let escapeReady = false;

  const clearEscapeTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    escapeReady = false;
  };

  const armEscapeTimer = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (options.onEvent !== undefined && pending.length === 1 && pending[0] === ESC) {
        pending = pending.subarray(1);
        options.onEvent(key("escape"));
      } else {
        escapeReady = true;
      }
    }, escTimeoutMs);
  };

  const parse = (): TerminalInputEvent[] => {
    const events: TerminalInputEvent[] = [];
    while (pending.length > 0) {
      if (paste) {
        const end = pending.indexOf(PASTE_END);
        if (end < 0) break;
        events.push({ type: "paste", text: pending.subarray(0, end).toString("utf8") });
        pending = pending.subarray(end + PASTE_END.length);
        paste = false;
        continue;
      }

      if (pending[0] === ESC) {
        if (pending.length === 1) {
          if (escapeReady) {
            pending = pending.subarray(1);
            escapeReady = false;
            events.push(key("escape"));
          } else {
            armEscapeTimer();
          }
          break;
        }
        clearEscapeTimer();
        if (pending.subarray(0, PASTE_START.length).equals(PASTE_START)) {
          pending = pending.subarray(PASTE_START.length);
          paste = true;
          continue;
        }
        if (pending[1] === 0x5b) {
          const final = findCsiFinal(pending);
          if (final < 0) break;
          const sequence = pending.subarray(0, final + 1).toString("ascii");
          pending = pending.subarray(final + 1);
          const event = parseCsi(sequence);
          if (event !== undefined) events.push(event);
          continue;
        }
        if (pending[1] === 0x4f) {
          if (pending.length < 3) break;
          const name = navigationName(String.fromCharCode(pending[2]!));
          pending = pending.subarray(3);
          if (name !== undefined) events.push(key(name));
          continue;
        }
        if (pending[1] === 0x03) {
          pending = pending.subarray(1);
          events.push(key("escape"));
          continue;
        }
        const decoded = decodeFirstCharacter(pending.subarray(1));
        if (decoded === undefined) break;
        pending = pending.subarray(1 + decoded.bytes);
        events.push(character(decoded.ch, true));
        continue;
      }

      const byte = pending[0]!;
      if (byte < 0x20 || byte === 0x7f) {
        pending = pending.subarray(1);
        events.push(control(byte));
        continue;
      }
      const decoded = decodeFirstCharacter(pending);
      if (decoded === undefined) break;
      pending = pending.subarray(decoded.bytes);
      events.push(character(decoded.ch, false));
    }
    return events;
  };

  return {
    feed(chunk) {
      if (chunk.length > 0) {
        if (pending.length === 1 && pending[0] === ESC) clearEscapeTimer();
        pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
      }
      return parse();
    },
    flush() {
      return parse();
    },
    destroy() {
      clearEscapeTimer();
      pending = Buffer.alloc(0);
    }
  };
}

function findCsiFinal(input: Buffer): number {
  for (let index = 2; index < input.length; index += 1) {
    const byte = input[index]!;
    if (byte >= 0x40 && byte <= 0x7e) return index;
  }
  return -1;
}

function parseCsi(sequence: string): TerminalInputEvent | undefined {
  if (sequence.startsWith("\u001b[<") && (sequence.endsWith("M") || sequence.endsWith("m"))) {
    const fields = sequence.slice(3, -1).split(";");
    if ((fields[0] === "64" || fields[0] === "65") && fields.length === 3) {
    return {
      type: "wheel",
        direction: fields[0] === "64" ? "up" : "down",
        x: Number(fields[1]) - 1,
        y: Number(fields[2]) - 1
    };
    }
  }
  const final = sequence.at(-1)!;
  const name = navigationName(final) ?? ({ "5": "pageup", "6": "pagedown" }[sequence.slice(2, -1)]);
  if (name === undefined) return undefined;
  const parameters = sequence.slice(2, -1).split(";");
  const modifier = parameters.length > 1 ? Number(parameters.at(-1)) : 1;
  return key(name, {
    shift: modifier === 2 || modifier === 4 || modifier === 6 || modifier === 8,
    alt: modifier === 3 || modifier === 4 || modifier === 7 || modifier === 8,
    ctrl: modifier === 5 || modifier === 6 || modifier === 7 || modifier === 8
  });
}

function navigationName(final: string): string | undefined {
  return ({ A: "up", B: "down", C: "right", D: "left", H: "home", F: "end" } as Record<string, string>)[final];
}

function control(byte: number): Extract<TerminalInputEvent, { type: "key" }> {
  if (byte === 0x0d || byte === 0x0a) return key("enter");
  if (byte === 0x09) return key("tab");
  if (byte === 0x7f || byte === 0x08) return key("backspace");
  if (byte === 0x20) return character(" ", false);
  if (byte >= 1 && byte <= 26) return key(String.fromCharCode(96 + byte), { ctrl: true });
  return key(`control-${byte}`);
}

function character(ch: string, alt: boolean): Extract<TerminalInputEvent, { type: "key" }> {
  return { type: "key", name: ch, ch, ctrl: false, alt, shift: ch.toLocaleUpperCase() === ch && ch.toLocaleLowerCase() !== ch };
}

function key(name: string, flags: Partial<Pick<Extract<TerminalInputEvent, { type: "key" }>, "ctrl" | "alt" | "shift">> = {}): Extract<TerminalInputEvent, { type: "key" }> {
  return { type: "key", name, ctrl: flags.ctrl ?? false, alt: flags.alt ?? false, shift: flags.shift ?? false };
}

function decodeFirstCharacter(input: Buffer): { ch: string; bytes: number } | undefined {
  if (input.length === 0) return undefined;
  const first = input[0]!;
  const bytes = first < 0x80 ? 1 : first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
  if (input.length < bytes) return undefined;
  return { ch: input.subarray(0, bytes).toString("utf8"), bytes };
}
