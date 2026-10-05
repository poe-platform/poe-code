/** Select from a fixed ASCII control vocabulary without retaining input tokens.
 * EPUB's existing control lists split on U+0020, including after XML attribute
 * normalization; tabs introduced by character references remain token content.
 * UTF-8 continuation bytes cannot match an ASCII control token. */
export async function selectEpubTokens(source: AsyncIterable<Uint8Array>, wanted: readonly string[], cooperate: () => Promise<void>): Promise<string[]> {
  const found = wanted.map(() => false), candidates = wanted.map(() => true);
  const maximum = Math.max(0, ...wanted.map(token => token.length));
  let length = 0;
  const finish = () => {
    for (let index = 0; index < wanted.length; index++) if (length && candidates[index] && length === wanted[index]!.length) found[index] = true;
    candidates.fill(true); length = 0;
  };
  for await (const bytes of source) {
    await cooperate();
    for (let offset = 0; offset < bytes.length; offset++) {
      if (offset && offset % 4096 === 0) await cooperate();
      const byte = bytes[offset]!;
      if (byte === 32) finish();
      else {
        for (let index = 0; index < wanted.length; index++) if (byte !== wanted[index]!.charCodeAt(length)) candidates[index] = false;
        if (length <= maximum) length++;
      }
    }
  }
  finish();
  return wanted.filter((_token, index) => found[index]);
}
