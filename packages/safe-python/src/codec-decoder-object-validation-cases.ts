/** These guest programs also run unchanged on the pinned external oracle. */
export const codecDecoderObjectValidationCases = [
  ["ascii_decode", "b'\\xff'"],
  ["utf_8_decode", "b'\\xff'"],
  ["utf_7_decode", "b'\\xff'"],
  ["utf_16_le_decode", "b'\\x00\\xdc'"],
  ["utf_16_be_decode", "b'\\xdc\\x00'"],
  ["utf_32_le_decode", "b'\\x00\\x00\\x11\\x00'"],
  ["utf_32_be_decode", "b'\\x00\\x11\\x00\\x00'"]
].map(([name, input]) => ({name, source: `
import _codecs
failure = ValueError('index failed')
for phase in ('handler', 'index'):
    for shape in ('deleted', 'none', 'str', 'int'):
        for resume in (-1, 100, 2**100, 1.5, 'repair', 'raise'):
            events = []
            def mutate():
                if shape == 'deleted':
                    del caught.object
                elif shape == 'none':
                    caught.object = None
                elif shape == 'str':
                    caught.object = 'wrong'
                else:
                    caught.object = 1
            class Position:
                def __index__(self):
                    events.append('index')
                    if phase == 'index':
                        mutate()
                    if resume == 'repair':
                        caught.object = b''
                        return 0
                    if resume == 'raise':
                        raise failure
                    return resume
            def handler(error):
                global caught
                caught = error
                events.append('handler')
                if phase == 'handler':
                    mutate()
                return ('!', Position())
            _codecs.register_error('object_validation', handler)
            try:
                result = _codecs.${name}(${input}, 'object_validation')
            except BaseException as error:
                print(phase, shape, resume, type(error).__name__, error.args, error is failure, events)
            else:
                print(phase, shape, resume, result, events)
` }));
