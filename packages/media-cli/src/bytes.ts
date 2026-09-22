/** Grammar uses a reversible one-byte alphabet, never Unicode-decoded operands. */
export function byteText(bytes: Uint8Array): string {
  let value = "";
  // Interpret the native buffer, never a producer-supplied iterator that can
  // replace signed URL octets or disguise a protocol as a filesystem path.
  for (let index = 0; index < bytes.length; index++) value += String.fromCharCode(bytes[index]);
  return value;
}
export function textBytes(text: string): Uint8Array {
  return Uint8Array.from(text, char => char.charCodeAt(0));
}

/** FFmpeg av_get_token quoting. Apply at each grammar layer, not globally. */
export function token(input: string, start: number, delimiters: string): { value: string; end: number } {
  let i = start;
  while (" \t\r\n".includes(input[i] ?? "\0")) i++;
  let value = "";
  let protectedEnd = 0;
  while (i < input.length && !delimiters.includes(input[i])) {
    const char = input[i++];
    if (char === "\\" && i < input.length) {
      value += input[i++];
      protectedEnd = value.length;
    } else if (char === "'") {
      while (i < input.length && input[i] !== "'") value += input[i++];
      if (input[i] === "'") { i++; protectedEnd = value.length; }
    } else value += char;
  }
  while (value.length > protectedEnd && " \t\r\n".includes(value.at(-1)!)) value = value.slice(0, -1);
  return { value, end: i };
}
