/** Identical programs run by the pinned external oracle and the guest interpreter. */
export const codecIncrementalObjectResumeAuditCases = [
  {encoding: "utf-8", prefix: [0xe2], invalid: [65], replacement: [66, 0xe2]},
  {encoding: "utf-8-sig", prefix: [0xe2], invalid: [65], replacement: [66, 0xe2]},
  {encoding: "utf-16-le", prefix: [0], invalid: [0xdc], replacement: [66, 0, 67]},
  {encoding: "utf-16-be", prefix: [0xdc], invalid: [0], replacement: [0, 66, 67]},
  {encoding: "utf-32-le", prefix: [0], invalid: [0, 17, 0], replacement: [66, 0, 0, 0, 67]},
  {encoding: "utf-32-be", prefix: [0], invalid: [17, 0, 0], replacement: [0, 0, 0, 66, 67]},
].flatMap(({encoding, prefix, invalid, replacement}) =>
  [false, true].flatMap(final => ["start", "end", "outside"].map(resume => ({
    name: `${encoding}; final=${final}; resume=${resume}`,
    source: `import codecs
events = []
decoder = codecs.getincrementaldecoder('${encoding}')('object-resume-audit')
class Position:
    def __index__(self):
        events.append(('index', decoder.getstate()))
        return ${resume === "start" ? `-${replacement.length}` : resume === "end" ? "-1" : `-${replacement.length + 1}`}
def recover(error):
    events.append(('error', error.encoding, error.object, error.start, error.end, error.reason, decoder.getstate()))
    if len(events) > 2:
        return ('Z', len(error.object))
    error.object = bytes(${JSON.stringify(replacement)})
    return ('R', Position())
codecs.register_error('object-resume-audit', recover)
print('prefix', repr(decoder.decode(bytes(${JSON.stringify(prefix)}))), decoder.getstate())
try:
    print('decoded', repr(decoder.decode(bytes(${JSON.stringify(invalid)}), ${final ? "True" : "False"})))
except BaseException as error:
    print('failure', type(error).__name__, error.args)
print('events', events)
print('state', decoder.getstate())
decoder.errors = 'replace'
print('flush', repr(decoder.decode(b'', True)), decoder.getstate())
decoder.reset()
print('reset', decoder.getstate(), flush=True)
`,
  }))),
);
