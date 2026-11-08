export const vectors = Object.freeze({
  binary: Object.freeze({
    chunks: Object.freeze(['d14e00', '', 'f08391', '42217f0a', '5a']),
    whole: 'd14e00f0839142217f0a5a',
    tail: '839142217f0a5a',
    head: 'd14e00f083914221',
  }),
  records: Object.freeze({
    chunks: Object.freeze(['7072650a61', '', '6263', '0a6465', '66']),
    whole: '7072650a6162630a646566',
    tail: '6162630a646566',
    lines: Object.freeze([
      Object.freeze({ hex: '707265', terminated: true }),
      Object.freeze({ hex: '616263', terminated: true }),
      Object.freeze({ hex: '646566', terminated: false }),
    ]),
  }),
  patterns: Object.freeze({
    chunks: Object.freeze(['636f', '', '62616c740a', '756d', '626572']),
    whole: '636f62616c740a756d626572',
    haystack: '636f62616c740a6e6f70650a756d6265720a',
    matches: '636f62616c740a756d6265720a',
  }),
});

export const counts = Object.freeze({ internal: 10, public: 20, total: 30 });
