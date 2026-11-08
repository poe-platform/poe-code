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

const NAMED_KEY_LOWER = new Map(
  (Object.entries(NAMED_KEY_SEQUENCES) as [string, string][]).map(([k, v]) => [k.toLowerCase(), v])
);

const VALID_KEYS_HINT = `Valid keys: ${Object.keys(NAMED_KEY_SEQUENCES).join(", ")}, Control+<letter>, Alt+<key>`;
const NAMED_KEY_PATTERN = Object.keys(NAMED_KEY_SEQUENCES).map(caseInsensitivePattern).join("|");

export const TERMINAL_KEY_PATTERN = `^(?:${NAMED_KEY_PATTERN}|.|[Cc][Oo][Nn][Tt][Rr][Oo][Ll]\\+[A-Za-z]|[Aa][Ll][Tt]\\+.+)$`;

function unknownKeyError(key: string): Error {
  return new Error(`Unknown terminal key: ${key}. ${VALID_KEYS_HINT}`);
}

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
  const lowerKey = (key as string).toLowerCase();

  const namedSequence = NAMED_KEY_LOWER.get(lowerKey);
  if (namedSequence !== undefined) {
    return namedSequence;
  }

  if (lowerKey.startsWith("control+")) {
    return controlKeyToSequence((key as string).slice("control+".length));
  }

  if (lowerKey.startsWith("alt+")) {
    const nestedKey = (key as string).slice("alt+".length);
    if (nestedKey.length === 0) {
      throw unknownKeyError(key);
    }

    if (nestedKey.length === 1) {
      return "\x1b" + nestedKey;
    }

    try {
      return "\x1b" + keyToSequence(nestedKey as TerminalKey);
    } catch {
      throw unknownKeyError(key);
    }
  }

  if ((key as string).length === 1) {
    return key as string;
  }

  throw unknownKeyError(key);
}

function controlKeyToSequence(controlKey: string): string {
  if (controlKey.length !== 1) {
    throw unknownKeyError(`Control+${controlKey}`);
  }

  const uppercaseLetter = controlKey.toUpperCase();
  const charCode = uppercaseLetter.charCodeAt(0);
  if (charCode < 65 || charCode > 90) {
    throw unknownKeyError(`Control+${controlKey}`);
  }

  return String.fromCharCode(charCode - 64);
}

function caseInsensitivePattern(value: string): string {
  let pattern = "";

  for (const character of value) {
    const lower = character.toLowerCase();
    const upper = character.toUpperCase();
    pattern += lower === upper ? escapePatternCharacter(character) : `[${upper}${lower}]`;
  }

  return pattern;
}

function escapePatternCharacter(character: string): string {
  return character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
