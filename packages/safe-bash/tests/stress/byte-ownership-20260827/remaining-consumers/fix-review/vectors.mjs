export const cases = [];
for (const status of [307, 308, 503]) {
  for (const kind of ['buffer', 'native']) {
    for (const input of ['stdin', 'mixed']) {
      cases.push({ id: `curl-${status}-${kind}-${input}`, family: 'curl', status, kind, input, expect: 0 });
    }
  }
}
for (const [guard, expect] of [['deny-hop', 7], ['cross-origin', 0], ['downgrade', 1], ['userinfo', 3], ['replay-limit', 65], ['upload-limit', 63], ['retry-deny', 7], ['abort', 'abort']]) {
  cases.push({ id: `curl-${guard}`, family: 'curl', status: guard === 'retry-deny' ? 503 : 307, kind: 'buffer', input: 'mixed', guard, expect });
}
for (const profile of ['json', 'raw', 'null', 'pipeline']) {
  for (const kind of ['buffer', 'native']) cases.push({ id: `jq-${profile}-${kind}`, family: 'jq', profile, kind, expect: 0 });
}
for (const [profile, expect] of [['source-exact', 0], ['source-excess', 5], ['reader-error', 2], ['utf8', 3], ['input-limit', 5], ['abort', 'abort']]) {
  cases.push({ id: `jq-${profile}`, family: 'jq', profile, kind: 'native', expect });
}
export const count = 34;
export const payload = Buffer.from(Array.from({ length: 173 }, (_, index) => (index * 47 + 19) % 256));
export const uploadFile = Buffer.from(Array.from({ length: 219 }, (_, index) => (index * 29 + 137) % 256));
export const programs = { json: '.amount + 13', raw: '. + "!"', null: '31 + 12', pipeline: '.amount + 13', 'source-exact': '.amount + 13', 'source-excess': '.amount + 13', 'reader-error': '.amount + 13', utf8: Buffer.from([0xff, 0x2e]), 'input-limit': '.', abort: '.amount + 13' };
export const outputs = { json: '42\n', raw: 'red!\nblue!\n', null: '43\n', pipeline: '42\n', 'source-exact': '42\n' };
