export const count = 24;
export const vectors = Object.freeze({
  raw: { chunks: ['41e2', '', '82acff', '0a42c328'], whole: '41e282acff0a42c328', output: '41e282acefbfbd0a42efbfbd280a' },
  json: { chunks: ['7b2278223a22e2', '', '82acff227d0a', '7b2278223a327d0a'], whole: '7b2278223a22e282acff227d0a7b2278223a327d0a', output: '5b7b2278223a22e282acefbfbd227d2c7b2278223a327d5d0a' },
  program: { chunks: ['2e', '', '78'], whole: '2e78', output: '370a' },
  context: { chunks: ['626566', '', '6f72650a6869740a', '61667465720a'], whole: '6265666f72650a6869740a61667465720a', output: '6265666f72650a6869740a61667465720a' },
  binary: { chunks: ['686974ff', '', '00c3280a', '6d6973730a'], whole: '686974ff00c3280a6d6973730a', output: '686974ff00c3280a' },
  payload: { chunks: ['a0ff', '', '00c3', '280a'], whole: 'a0ff00c3280a' },
  replay: { output: '5326a0ff00c3280a' },
});

export const commands = Object.freeze({
  raw: 'jq -Rrs . /input',
  json: 'jq -cs . /input | jq -c .',
  program: 'jq -f /program /input',
  context: 'rg -F -B 1 -A 1 hit /input',
  binary: 'rg -a -F hit /input',
  tarPlain: 'tar -xf /archive -C /out',
  tarGzip: 'tar -xzf /archive -C /out',
  tarCreate: 'tar -cf - -C /in payload | tar -xf - -C /out',
  download: 'curl -sS -o /download https://fixture.invalid/start',
  upload: 'curl -sS -T /upload https://fixture.invalid/start',
  replay: 'curl -sS -L --data-binary @- --data-binary @/upload https://fixture.invalid/start',
});
