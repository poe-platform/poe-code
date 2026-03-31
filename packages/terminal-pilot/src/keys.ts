const NAMED_KEY_SEQUENCES = {
  Enter: "\r",
  Tab: "\t",
  Escape: "\x1b",
  Backspace: "\x7f",
  Delete: "\x1b[3~",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Space: " "
} as const;

export type TerminalKey =
  | "Enter"
  | "Tab"
  | "Escape"
  | "Backspace"
  | "Delete"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown"
  | "Space"
  | `Control+${string}`
  | `Alt+${string}`;

export function keyToSequence(key: TerminalKey): string {
  const namedSequence = NAMED_KEY_SEQUENCES[key as keyof typeof NAMED_KEY_SEQUENCES];
  if (namedSequence !== undefined) {
    return namedSequence;
  }

  if (key.startsWith("Control+")) {
    return controlKeyToSequence(key as `Control+${string}`);
  }

  if (key.startsWith("Alt+")) {
    const nestedKey = key.slice("Alt+".length);
    if (nestedKey.length === 0) {
      throw new Error(`Unknown terminal key: ${key}`);
    }

    if (nestedKey.length === 1) {
      return "\x1b" + nestedKey;
    }

    try {
      return "\x1b" + keyToSequence(nestedKey as TerminalKey);
    } catch {
      throw new Error(`Unknown terminal key: ${key}`);
    }
  }

  throw new Error(`Unknown terminal key: ${key}`);
}

function controlKeyToSequence(key: `Control+${string}`): string {
  const controlKey = key.slice("Control+".length);
  if (controlKey.length !== 1) {
    throw new Error(`Unknown terminal key: ${key}`);
  }

  const uppercaseLetter = controlKey.toUpperCase();
  const charCode = uppercaseLetter.charCodeAt(0);
  if (charCode < 65 || charCode > 90) {
    throw new Error(`Unknown terminal key: ${key}`);
  }

  return String.fromCharCode(charCode - 64);
}
