import wide from "./runtime/__snapshots__/codec-wide-boundary-audit-3.14.7.json" with {type: "json"};
import utf7 from "./runtime/__snapshots__/codec-utf7-boundary-audit-3.14.7.json" with {type: "json"};

interface BoundaryCase {
  readonly width?: number;
  readonly order?: number;
  readonly policy: string;
  readonly final: boolean;
  readonly input: readonly number[];
  readonly expected: {
    readonly result?: readonly unknown[];
    readonly error?: readonly unknown[];
    readonly args?: readonly unknown[];
  };
}

export const codecBoundaryAuditCases: readonly BoundaryCase[] = [...wide.cases, ...utf7.cases];

/** Each batch preserves the full external corpus and runs through native guest
 * entry points. JSON's arrays, numbers and ASCII strings are Python literals;
 * booleans are emitted separately as Python keywords. */
export const codecBoundaryAuditPrograms = Array.from({length: codecBoundaryAuditCases.length / 100}, (_, batch) => {
  const rows = codecBoundaryAuditCases.slice(batch * 100, (batch + 1) * 100);
  const first = rows[0];
  const functionName = first.width === undefined ? "utf_7_decode" : `utf_${first.width}_ex_decode`;
  const samples = rows.map(row => [row.input, row.expected.result === undefined
    ? ["error", ...row.expected.error!, row.expected.args]
    : ["result", ...row.expected.result]]);
  return {
    name: `${functionName} order=${first.order ?? 0} ${first.policy} final=${first.final} batch=${batch}`,
    source: `from _codecs import ${functionName} as decode
samples = ${JSON.stringify(samples)}
for raw, expected in samples:
    data = bytes(raw)
    try:
        result = decode(data, '${first.policy}', ${first.width === undefined ? "" : `${first.order}, `}${first.final ? "True" : "False"})
    except UnicodeDecodeError as error:
        assert type(error) is UnicodeDecodeError
        assert type(error.object) is bytes and error.object == data
        assert type(error.args) is tuple
        actual = ['error', error.encoding, error.start, error.end, error.reason,
                  [error.args[0], list(error.args[1]), error.args[2], error.args[3], error.args[4]]]
    else:
        assert type(result) is tuple and type(result[0]) is str
        assert type(result[1]) is int
        actual = ['result', [ord(character) for character in result[0]], result[1]]
        if len(result) == 3:
            assert type(result[2]) is int
            actual.append(result[2])
    assert actual == expected, (raw, expected, actual)
print('100 boundary cases passed')
`,
  };
});
