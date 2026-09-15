/** Shared unchanged programs for the public interpreter and pinned oracle.
 * Each program bounds its own session budget while retaining every input pair.
 */
export const codecReplacedInputMatrixCases = [
  "utf_7", "utf_8", "utf_16_le", "utf_16_be", "utf_32_le", "utf_32_be",
  "unicode_escape", "raw_unicode_escape", "ascii"
].flatMap(encoding => (encoding === "ascii" ? ["omitted"] : ["omitted", "False", "True"]).map(final => ({
  name: `${encoding}: final=${final}`,
  source: String.raw`import codecs
for original in (b'\xff', b'\xff\xff\xff\xff\xff', b'\x00\xd8', b'\x00\x00\x11\x00', bytes([92, 117, 88, 89]), b'+A'):
    for replacement in (b'', b'X', b'X+A', b'+2AA', b'\xff\xff', b'\x00\xd8', b'\x00\x00\x11\x00', bytes([92, 117, 88])):
        for negative in (False, True):
            seen = []
            faults = []
            def handler(error):
                faults.append(error)
                seen.append((error.object, error.start, error.end, error.reason))
                if len(seen) == 1:
                    error.object = replacement
                    return ('?', -len(replacement) if negative else 0)
                return ('!', len(error.object))
            codecs.register_error('matrix_replaced_input', handler)
            try:
                result = codecs.${encoding}_decode(original, 'matrix_replaced_input'${final === "omitted" ? "" : `, ${final}`})
                print(original, replacement, negative, result)
            except Exception as error:
                print(original, replacement, negative, type(error).__name__, error.args)
            print(seen)
            print([error is faults[0] for error in faults])
            print([error.args for error in faults])
`
})));
