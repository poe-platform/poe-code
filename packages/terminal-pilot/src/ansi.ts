const ESC = 0x1b;
const BEL = 0x07;
const ST = 0x9c;
const CSI = 0x9b;
const OSC = 0x9d;
const DCS = 0x90;
const SOS = 0x98;
const PM = 0x9e;
const APC = 0x9f;

export function stripAnsi(input: string): string {
  let output = "";

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);

    if (code === ESC) {
      const nextCode = input.charCodeAt(index + 1);

      if (nextCode === 0x5b) {
        index = consumeCsi(input, index + 2);
        continue;
      }

      if (nextCode === 0x5d) {
        index = consumeTerminatedString(input, index + 2, true);
        continue;
      }

      if (nextCode === 0x50 || nextCode === 0x58 || nextCode === 0x5e || nextCode === 0x5f) {
        index = consumeTerminatedString(input, index + 2, false);
        continue;
      }

      if (!Number.isNaN(nextCode)) {
        index += 1;
      }

      continue;
    }

    if (code === CSI) {
      index = consumeCsi(input, index + 1);
      continue;
    }

    if (code === OSC) {
      index = consumeTerminatedString(input, index + 1, true);
      continue;
    }

    if (code === DCS || code === SOS || code === PM || code === APC) {
      index = consumeTerminatedString(input, index + 1, false);
      continue;
    }

    output += input[index];
  }

  return output;
}

function consumeCsi(input: string, index: number): number {
  while (index < input.length) {
    const code = input.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index;
    }

    index += 1;
  }

  return input.length;
}

function consumeTerminatedString(
  input: string,
  index: number,
  allowBellTerminator: boolean
): number {
  while (index < input.length) {
    const code = input.charCodeAt(index);

    if (code === ST || (allowBellTerminator && code === BEL)) {
      return index;
    }

    if (code === ESC && input.charCodeAt(index + 1) === 0x5c) {
      return index + 1;
    }

    index += 1;
  }

  return input.length;
}
