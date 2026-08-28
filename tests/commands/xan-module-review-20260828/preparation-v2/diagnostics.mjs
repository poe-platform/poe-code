import assert from 'node:assert/strict';

const predicates = {
  U03: [/invalid|malformed|incomplete/i, /utf[- ]?8/i],
  R01: [/unsupported|not supported|bounded.*refus/i, /--parallel(?![\w-])/],
  R02: [/unsupported|not supported|bounded.*refus/i, /--approx(?![\w-])/],
  R03: [/unsupported|not supported|bounded.*refus/i, /--evaluate(?![\w-])/],
  R04: [/unsupported|not supported|bounded.*refus/i, /--evaluate-file(?![\w-])/],
  R05: [/unsupported|not supported|bounded.*refus/i, /--raw(?![\w-])/],
  'X4-S01': [/empty/i, /clause|selector|selection/i],
  'X4-S02': [/colon|range/i, /repeat|multiple|extra|unsupported/i],
  'X4-S03': [/prefix|wildcard|a\*/i, /colon|range|unsupported/i],
  'X4-S04': [/suffix|\*a/i, /occurrence|bracket|unsupported/i],
  'X4-S05': [/quote/i, /junk|trailing|after|unsupported/i],
  'X4-N01': [/occurrence/i, /empty|invalid|integer|number/i],
  'X4-N02': [/occurrence/i, /range|overflow|i64|integer|invalid/i],
  'X4-R01': [/missing|unknown|not found|no .*match/i, /name|header|column|missing/i],
  'X4-R02': [/index|column/i, /range|bounds|invalid|missing/i],
  'X4-R03': [/occurrence/i, /missing|range|bounds|not found|no .*match/i],
  'X4-R04': [/prefix|z\*/i, /missing|not found|no .*match/i],
  'X4-R05': [/suffix|\*z/i, /missing|not found|no .*match/i],
  'X4-R06': [/name|named/i, /-n\b|no.headers|without.*header/i, /forbid|unsupported|cannot|not allowed|invalid/i],
  'X4-R07': [/\*/, /missing|unknown|not found|no .*match/i, /name|header|endpoint/i],
  'X4-R08': [/9223372036854775808/, /name|header/i, /missing|unknown|not found|no .*match/i],
  'B01-R1-repeat': [/repeat|duplicate|multiple/i, /(?:^|[\s'"`(:])-n(?=$|[\s'"`):,;.])/],
  'B01-R2-cr': [/delimiter/i, /invalid|unsupported|forbid|ASCII|single/i],
  'B01-R3-space': [/length|number|integer|numeric|-l\b/i, /invalid|digit|empty|space|positive|unsigned/i],
  'B01-R4-start-length': [/overflow|range|u64/i, /start/i, /len/i],
  'B01-R4-index-one': [/overflow|range|u64/i, /index|-i\b/],
  'B01-R4-header-column': [/overflow|range|u64/i, /start|column/i],
  'B01-R5-interior': [/empty/i, /clause|selector|selection/i],
  'B01-R6-L-range': [/conflict|combine|exclusive|incompatible|mix/i, /-L\b|--last\b/, /range|-l\b|--len\b/],
  'B01-R6-I-range': [/conflict|combine|exclusive|incompatible|mix/i, /-I\b|--indices\b/, /range|-s\b|--start\b/],
  'B01-R6-L-I': [/conflict|combine|exclusive|incompatible|mix/i, /-L\b|--last\b/, /-I\b|--indices\b/],
  'B01-R7-invalid-plural': [/invalid|number|integer|index|indices/i, /(?:^|[\s'"`(:])-I(?=$|[\s'"`):,;.])/],
};

export const diagnosticExamples = {
  U03: 'invalid UTF-8', R01: 'unsupported --parallel', R02: 'unsupported --approx',
  R03: 'unsupported --evaluate', R04: 'unsupported --evaluate-file', R05: 'unsupported --raw',
  'X4-S01': 'empty selector clause', 'X4-S02': 'repeated range colon',
  'X4-S03': 'prefix followed by colon', 'X4-S04': 'suffix followed by occurrence',
  'X4-S05': 'trailing junk after closing quote', 'X4-N01': 'empty occurrence integer',
  'X4-N02': 'occurrence integer outside i64 range', 'X4-R01': 'missing header name',
  'X4-R02': 'column index out of bounds', 'X4-R03': 'occurrence out of range',
  'X4-R04': 'prefix has no match', 'X4-R05': 'suffix has no match',
  'X4-R06': 'named selector forbidden under -n', 'X4-R07': 'missing endpoint header name *',
  'X4-R08': 'missing header name 9223372036854775808',
  'B01-R1-repeat': 'repeated singleton -n', 'B01-R2-cr': 'invalid delimiter',
  'B01-R3-space': 'invalid length number', 'B01-R4-start-length': 'start plus length overflow',
  'B01-R4-index-one': 'index plus one overflow', 'B01-R4-header-column': 'header start plus column overflow',
  'B01-R5-interior': 'empty selector clause', 'B01-R6-L-range': 'conflicting -L and range -l',
  'B01-R6-I-range': 'conflicting -I and range -s', 'B01-R6-L-I': 'conflicting -L and -I',
  'B01-R7-invalid-plural': 'invalid integer for -I',
};

export function exampleDiagnostic(row) {
  return `xan ${row.argv[0]}: ${row.requiredDiagnosticFamily ? `${row.requiredDiagnosticFamily} ` : ''}${diagnosticExamples[row.id]}\n`;
}

export function matcher(row) {
  const tests = predicates[row.id];
  assert.ok(tests, `No contextual matcher: ${row.id}`);
  const expectedArgv = JSON.stringify(row.argv);
  return {
    id: row.id,
    assert(data, context = row) {
      assert.equal(context.id, row.id);
      assert.equal(JSON.stringify(context.argv), expectedArgv, 'diagnostic argv binding');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      assert.ok(data.byteLength > 0 && data.byteLength <= 65536, 'bounded diagnostic');
      const command = row.argv[0] === 'h' ? 'headers' : row.argv[0];
      const prefix = /^xan\s+(\S+?):?\s/.exec(text);
      if (row.group === 'selector36' || row.id === 'U03') assert.match(text, new RegExp(`^xan ${command}:?\\s`, 'u'), 'required command identity');
      if (prefix) assert.equal(prefix[1].replace(/:$/, ''), command, 'wrong command context');
      const clauses = text.trim().split('\n').filter(line => line.trim());
      assert.ok(clauses.some(clause => tests.every(test => test.test(clause))), `one contextual condition ${row.id}, not unrelated substrings`);
      if (row.requiredDiagnosticFamily) assert.ok(text.includes(row.requiredDiagnosticFamily), 'inherited literal family');
      if (row.id === 'B01-R7-invalid-plural') {
        assert.doesNotMatch(text, /(?:invalid|offending|rejected)\s+(?:option\s+)?['"`]?-(?:i|\-index)(?=['"`\s:,;.]|$)/, 'offending option is plural');
      }
    },
  };
}

export function matcherMap(rows) {
  const selected = rows.filter(row => row.expected.stderr.precision);
  assert.equal(selected.length, 32);
  assert.deepEqual(selected.map(row => row.id).sort(), Object.keys(predicates).sort());
  return new Map(selected.map(row => [row.id, matcher(row)]));
}
