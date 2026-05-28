export type Color =
  | { type: "ansi4"; index: number }
  | { type: "ansi8"; index: number }
  | { type: "rgb"; r: number; g: number; b: number };

export type StyledRun = {
  text: string;
  fg: Color | null;
  bg: Color | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  dim: boolean;
  inverse: boolean;
  conceal: boolean;
};

type StyleState = Omit<StyledRun, "text">;

const ESC = "\u001b";

function createDefaultStyle(): StyleState {
  return {
    fg: null,
    bg: null,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    dim: false,
    inverse: false,
    conceal: false
  };
}

function cloneStyle(style: StyleState): StyleState {
  return { ...style };
}

function stylesEqual(left: StyleState, right: StyleState): boolean {
  return (
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.strikethrough === right.strikethrough &&
    left.dim === right.dim &&
    left.inverse === right.inverse &&
    left.conceal === right.conceal &&
    colorsEqual(left.fg, right.fg) &&
    colorsEqual(left.bg, right.bg)
  );
}

function colorsEqual(left: Color | null, right: Color | null): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right || left.type !== right.type) {
    return false;
  }

  if (left.type === "rgb" && right.type === "rgb") {
    return left.r === right.r && left.g === right.g && left.b === right.b;
  }

  if ((left.type === "ansi4" || left.type === "ansi8") && left.type === right.type) {
    return left.index === right.index;
  }

  return false;
}

function pushRun(runs: StyledRun[], style: StyleState, text: string): void {
  if (text.length === 0) {
    return;
  }

  const previous = runs.at(-1);
  if (previous && text !== "\n" && previous.text !== "\n" && stylesEqual(previous, style)) {
    previous.text += text;
    return;
  }

  runs.push({
    text,
    fg: style.fg,
    bg: style.bg,
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    strikethrough: style.strikethrough,
    dim: style.dim,
    inverse: style.inverse,
    conceal: style.conceal
  });
}

function parseCsi(input: string, start: number): { end: number; final: string | null; params: string } {
  let index = start + 2;

  while (index < input.length) {
    const code = input.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return {
        end: index + 1,
        final: input[index],
        params: input.slice(start + 2, index)
      };
    }

    index += 1;
  }

  return {
    end: input.length,
    final: null,
    params: input.slice(start + 2)
  };
}

function toInteger(value: string | undefined): number | null {
  if (!value || value.length === 0) {
    return null;
  }

  for (const char of value) {
    if (char < "0" || char > "9") {
      return null;
    }
  }

  return Number.parseInt(value, 10);
}

function clampByte(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 255) {
    return 255;
  }

  return value;
}

function applyExtendedColor(
  params: number[],
  start: number
): { color: Color | null; consumed: number } | null {
  const mode = params[start];
  if (mode === 5) {
    const index = params[start + 1];
    if (index === undefined) {
      return null;
    }

    return {
      color: { type: "ansi8", index: clampByte(index) },
      consumed: 2
    };
  }

  if (mode === 2) {
    const r = params[start + 1];
    const g = params[start + 2];
    const b = params[start + 3];
    if (r === undefined || g === undefined || b === undefined) {
      return null;
    }

    return {
      color: { type: "rgb", r: clampByte(r), g: clampByte(g), b: clampByte(b) },
      consumed: 4
    };
  }

  return null;
}

function applySgr(style: StyleState, paramsText: string): StyleState {
  const nextStyle = cloneStyle(style);
  const rawParams = paramsText.length === 0 ? ["0"] : paramsText.split(";");

  for (let index = 0; index < rawParams.length; index += 1) {
    const rawParam = rawParams[index] ?? "";
    const colonColor = applyColonExtendedColor(rawParam);
    if (colonColor !== undefined) {
      if (colonColor !== null) {
        if (colonColor.target === 38) {
          nextStyle.fg = colonColor.color;
        } else {
          nextStyle.bg = colonColor.color;
        }
      }
      continue;
    }

    const value = rawParam.length === 0 ? 0 : toInteger(rawParam);
    if (value === null) {
      return nextStyle;
    }

    if (value === 0) {
      Object.assign(nextStyle, createDefaultStyle());
      continue;
    }

    if (value === 1) {
      nextStyle.bold = true;
      continue;
    }

    if (value === 2) {
      nextStyle.dim = true;
      continue;
    }

    if (value === 22) {
      nextStyle.bold = false;
      nextStyle.dim = false;
      continue;
    }

    if (value === 3) {
      nextStyle.italic = true;
      continue;
    }

    if (value === 23) {
      nextStyle.italic = false;
      continue;
    }

    if (value === 4) {
      nextStyle.underline = true;
      continue;
    }

    if (value === 24) {
      nextStyle.underline = false;
      continue;
    }

    if (value === 9) {
      nextStyle.strikethrough = true;
      continue;
    }

    if (value === 29) {
      nextStyle.strikethrough = false;
      continue;
    }

    if (value === 7) {
      nextStyle.inverse = true;
      continue;
    }

    if (value === 27) {
      nextStyle.inverse = false;
      continue;
    }

    if (value === 8) {
      nextStyle.conceal = true;
      continue;
    }

    if (value === 28) {
      nextStyle.conceal = false;
      continue;
    }

    if (value === 39) {
      nextStyle.fg = null;
      continue;
    }

    if (value === 49) {
      nextStyle.bg = null;
      continue;
    }

    if (value >= 30 && value <= 37) {
      nextStyle.fg = { type: "ansi4", index: value - 30 };
      continue;
    }

    if (value >= 90 && value <= 97) {
      nextStyle.fg = { type: "ansi4", index: value - 90 + 8 };
      continue;
    }

    if (value >= 40 && value <= 47) {
      nextStyle.bg = { type: "ansi4", index: value - 40 };
      continue;
    }

    if (value >= 100 && value <= 107) {
      nextStyle.bg = { type: "ansi4", index: value - 100 + 8 };
      continue;
    }

    if (value === 38 || value === 48) {
      const params = rawParams.map((param) => toInteger(param));
      const extended = params.every((param) => param !== null)
        ? applyExtendedColor(params as number[], index + 1)
        : null;
      if (!extended) {
        if (rawParams[index + 1] === "2" || rawParams[index + 1] === "5") {
          break;
        }
        continue;
      }

      if (value === 38) {
        nextStyle.fg = extended.color;
      } else {
        nextStyle.bg = extended.color;
      }

      index += extended.consumed;
    }
  }

  return nextStyle;
}

function applyColonExtendedColor(
  rawParam: string
): { target: 38 | 48; color: Color } | null | undefined {
  if (!rawParam.includes(":")) {
    return undefined;
  }

  const segments = rawParam.split(":");
  const target = toInteger(segments[0]);
  if (target !== 38 && target !== 48) {
    return null;
  }

  const mode = toInteger(segments[1]);
  if (mode === 5) {
    const index = toInteger(segments[2]);
    return index === null ? null : { target, color: { type: "ansi8", index: clampByte(index) } };
  }

  if (mode !== 2) {
    return null;
  }

  const offset = segments[2] === "" ? 3 : 2;
  const r = toInteger(segments[offset]);
  const g = toInteger(segments[offset + 1]);
  const b = toInteger(segments[offset + 2]);
  if (r === null || g === null || b === null) {
    return null;
  }

  return { target, color: { type: "rgb", r: clampByte(r), g: clampByte(g), b: clampByte(b) } };
}

export function parseAnsi(input: string): StyledRun[] {
  const runs: StyledRun[] = [];
  let style = createDefaultStyle();
  let textStart = 0;
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (char === "\n") {
      pushRun(runs, style, input.slice(textStart, index));
      pushRun(runs, style, "\n");
      index += 1;
      textStart = index;
      continue;
    }

    if (char === ESC && input[index + 1] === "[") {
      pushRun(runs, style, input.slice(textStart, index));
      const sequence = parseCsi(input, index);

      if (sequence.final === "m") {
        style = applySgr(style, sequence.params);
      }

      index = sequence.end;
      textStart = index;
      continue;
    }

    index += 1;
  }

  pushRun(runs, style, input.slice(textStart));

  return runs;
}
