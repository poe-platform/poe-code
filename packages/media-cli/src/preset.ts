// Source-informed fgets/av_strtok grammar: fftools/ffmpeg_opt.c opt_preset.
// FFmpeg 9.0.1 source notices and GPL/LGPL terms are retained in NOTICE.
import { byteText, textBytes } from './bytes.js';
import { discover } from './discover.js';
import { optionMetadata } from './options.generated.js';

/** Predict assignments from an already observed read. A syntax stop is advisory;
 * it must never replace the native invocation or its diagnostics/effects. */
export function* presetAssignments(content: Uint8Array): Generator<{
  index: number; key: string; value: Uint8Array; span: { start: number; end: number };
}> {
  const input = byteText(content);
  let start = 0, index = 0;
  while (start < input.length) {
    // fgets(line, sizeof(line), f) consumes at most 999 bytes, including newline.
    const newline = input.indexOf('\n', start);
    const end = Math.min(input.length, start + 999, newline < 0 ? input.length : newline + 1);
    let line = input.slice(start, end);
    const nul = line.indexOf('\0');
    if (nul >= 0) line = line.slice(0, nul);
    const span = { start, end };
    start = end;
    const readIndex = index++;
    if (!line || '#\n\r'.includes(line[0])) continue;
    // av_strtok skips leading delimiters when locating each token, but
    // opt_preset ignores its returned pointer. The original key/value pointers
    // retain leading delimiters; only the terminating delimiter is overwritten.
    let keyStart = 0;
    while (line[keyStart] === '=') keyStart++;
    const equals = line.indexOf('=', keyStart);
    if (equals < 0) throw new SyntaxError('Invalid preset assignment; later reads remain native-owned');
    let valueStart = equals + 1;
    while (valueStart < line.length && '\r\n'.includes(line[valueStart])) valueStart++;
    let valueEnd = valueStart;
    while (valueEnd < line.length && !'\r\n'.includes(line[valueEnd])) valueEnd++;
    if (valueStart === valueEnd) throw new SyntaxError('Invalid preset assignment; later reads remain native-owned');
    const key = line.slice(0, equals), value = textBytes(line.slice(equals + 1, valueEnd));
    yield { index: readIndex, key, value, span };
    // write_option returns AVERROR_EXIT for exit handlers. opt_preset then
    // attempts opt_default_new before deciding whether to read another line.
    // Stop hints at that boundary; any successful fallback stays a late read.
    // Reuse sequential lookup so no-prefix/slash/specifier spellings agree.
    const plan = discover('ffmpeg', [textBytes('-' + key), value], 'preset');
    // An unregistered option may be native-valid on a future build, but its
    // fallback arity/application is unknown here. Do not predict subsequent
    // reads across that boundary; complete native late access owns them.
    if (plan.deferred.some(item => item.reason === 'unknown-option')) return;
    const definitions: Readonly<Record<string, { exit: boolean }>> = optionMetadata.ffmpeg;
    if (plan.globals.some(option => Object.hasOwn(definitions, option.name) && definitions[option.name].exit)) return;
  }
}
