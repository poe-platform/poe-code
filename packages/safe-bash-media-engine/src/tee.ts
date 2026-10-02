// FFmpeg 9.0.1 libavformat/tee.c and tee_common.c; retained notices in NOTICE.
import { byteText, textBytes, token } from './bytes.js';

/** Advisory slave parsing. Malformed option lists remain native-owned; they do
 * not authorize reads or prevent later slaves from reaching native execution. */
export function teeResources(value: Uint8Array): { target: Uint8Array; options: ReadonlyMap<string, Uint8Array> }[] {
  const expression = byteText(value);
  const resources: { target: Uint8Array; options: ReadonlyMap<string, Uint8Array> }[] = [];
  let cursor = 0;
  while (cursor < expression.length) {
    const slave = token(expression, cursor, '|');
    cursor = slave.end + 1;
    const options = new Map<string, Uint8Array>();
    let filename = 0;
    if (slave.value.startsWith('[')) {
      filename = 1;
      if (slave.value[filename] !== ']') {
        while (filename < slave.value.length) {
          const key = token(slave.value, filename, '=');
          if (!key.value || slave.value[key.end] !== '=') break;
          const argument = token(slave.value, key.end + 1, ':]');
          options.set(key.value, textBytes(argument.value));
          filename = argument.end;
          if (slave.value[filename] === ']') break;
          if (slave.value[filename] !== ':') break;
          filename++;
        }
      }
      if (slave.value[filename] !== ']') continue;
      filename++;
    }
    resources.push({ target: textBytes(slave.value.slice(filename)), options });
  }
  return resources;
}
