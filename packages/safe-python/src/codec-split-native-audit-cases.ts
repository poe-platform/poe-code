/** Unchanged guest programs shared by unit tests and the external oracle. */
export const codecSplitNativeAuditCases = [7, 16, 32].flatMap(width =>
  ["strict", "ignore", "replace", "surrogateescape", "surrogatepass", "backslashreplace"].map(policy => ({
    name: `UTF-${width} split input with ${policy}`,
    source: String.raw`
import _codecs
inputs = ${width === 7
    ? "(b'', b'+', b'+AKM-A', b'+2D3cDQ-Z', b'+AAA!Z', b'\\xff+AAB-Z')"
    : width === 16
      ? "(b'', b'\\xff\\xfeA\\x00', b'\\xfe\\xff\\xd8=\\xdc\\x0d', b'\\x00\\xd8A\\x00Z', b'\\xff\\xfe\\x00\\xdcZ', b'\\xfe\\xff\\xd8\\x00\\xff')"
      : "(b'', b'\\xff\\xfe\\x00\\x00A\\x00\\x00\\x00', b'\\x00\\x00\\xfe\\xff\\x00\\x01\\xf4\\x0d', b'\\x00\\x00\\x11\\x00Z', b'\\xff\\xfe\\x00\\x00\\x00\\xd8\\x00\\x00Z', b'\\x00\\x00\\xfe\\xff\\xff')"}
for data in inputs:
    for split in range(len(data) + 1):
        pending = data[:split]
        order = 0
        parts = []
        for final in (False, True):
            try:
                result = _codecs.${width === 7 ? "utf_7_decode(pending, '" + policy + "', final)" : "utf_" + width + "_ex_decode(pending, '" + policy + "', order, final)"}
                parts.append(('ok', result))
                pending = pending[result[1]:]
                ${width === 7 ? "pass" : "order = result[2]"}
            except UnicodeDecodeError as error:
                parts.append(('error', type(error).__name__, error.args, error.encoding, error.object, error.start, error.end, error.reason))
            if not final:
                pending += data[split:]
        print(repr((data, split, parts, pending, order)))
`
  })));
