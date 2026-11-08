export function stripAnsi(value: string): string {
  let output = "";
  let index = 0;

  while (index < value.length) {
    const char = value[index];

    if (char === "\u001b") {
      index = skipEscapeSequence(value, index);
      continue;
    }

    if (char === "\u009b") {
      index = skipCsiSequence(value, index + 1);
      continue;
    }

    output += char;
    index += char.length;
  }

  return output;
}

function skipEscapeSequence(value: string, index: number): number {
  const next = value[index + 1];

  if (next === "[") {
    return skipCsiSequence(value, index + 2);
  }

  if (next === "]") {
    return skipOscSequence(value, index + 2);
  }

  return Math.min(value.length, index + 2);
}

function skipCsiSequence(value: string, index: number): number {
  while (index < value.length) {
    const codePoint = value.charCodeAt(index);
    index += 1;

    if (codePoint >= 0x40 && codePoint <= 0x7e) {
      break;
    }
  }

  return index;
}

function skipOscSequence(value: string, index: number): number {
  while (index < value.length) {
    if (value[index] === "\u0007") {
      return index + 1;
    }

    if (value[index] === "\u001b" && value[index + 1] === "\\") {
      return index + 2;
    }

    index += 1;
  }

  return index;
}
