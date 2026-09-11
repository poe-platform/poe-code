export interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly args: readonly string[];
  readonly stdout: string;
  readonly stderr?: string;
  readonly status?: number;
  readonly files: Readonly<Record<string, string>>;
}

export const numericCases: readonly Fixture[] = [
  { name: "public numeric two", input: "alpha\nbeta\ngamma\n", args: ["-", "2"], stdout: "6\n11\n", files: { xx00: "alpha\n", xx01: "beta\ngamma\n" } },
  { name: "public elided suffix", input: "alpha\nbeta\ngamma\n", args: ["-z", "-fchunk", "-b%03d.txt", "-", "1"], stdout: "17\n", files: { "chunk000.txt": "alpha\nbeta\ngamma\n" } },
  { name: "empty first piece", input: "a\nb\n", args: ["-", "1"], stdout: "0\n4\n", files: { xx00: "", xx01: "a\nb\n" } },
  { name: "raw data", input: "a\0\r\nb\r", args: ["-", "2"], stdout: "4\n2\n", files: { xx00: "a\0\r\n", xx01: "b\r" } },
  { name: "finite additional repeat", input: "a\nb\nc\nd\ne\n", args: ["-", "2", "{1}"], stdout: "2\n4\n4\n", files: { xx00: "a\n", xx01: "b\nc\n", xx02: "d\ne\n" } },
  { name: "repeat zero", input: "a\nb\nc", args: ["-", "2", "{0}"], stdout: "2\n3\n", files: { xx00: "a\n", xx01: "b\nc" } },
  { name: "eof plus one deletes", input: "a\nb\n", args: ["-", "3"], stdout: "4\n", stderr: "csplit: '3': line number out of range\n", status: 1, files: {} },
  { name: "eof plus one keeps", input: "a\nb\n", args: ["-k", "-", "3"], stdout: "4\n", stderr: "csplit: '3': line number out of range\n", status: 1, files: { xx00: "a\nb\n" } },
  { name: "past eof partial kept", input: "a\nb\n", args: ["-k", "-", "8"], stdout: "4\n", stderr: "csplit: '8': line number out of range\n", status: 1, files: { xx00: "a\nb\n" } },
  { name: "numeric forever fails", input: "a\nb\nc\nd\ne\n", args: ["-", "2", "{*}"], stdout: "2\n4\n4\n", stderr: "csplit: '2': line number out of range on repetition 2\n", status: 1, files: {} },
  { name: "numeric forever keeps", input: "a\nb\nc\nd\ne\n", args: ["-k", "-", "2", "{*}"], stdout: "2\n4\n4\n", stderr: "csplit: '2': line number out of range on repetition 2\n", status: 1, files: { xx00: "a\n", xx01: "b\nc\n", xx02: "d\ne\n" } },
  { name: "equal numeric warns", input: "a\nb\nc\n", args: ["-", "2", "2"], stdout: "2\n0\n4\n", stderr: "csplit: warning: line number '2' is the same as preceding line number\n", files: { xx00: "a\n", xx01: "", xx02: "b\nc\n" } },
  { name: "elision reuses index", input: "a\nb\nc\n", args: ["-z", "-", "2", "2"], stdout: "2\n4\n", stderr: "csplit: warning: line number '2' is the same as preceding line number\n", files: { xx00: "a\n", xx01: "b\nc\n" } },
  { name: "descending admission", input: "a\nb\nc\n", args: ["-", "3", "2"], stdout: "", stderr: "csplit: line number '2' is smaller than preceding line number, 3\n", status: 1, files: {} },
  { name: "zero rejected", input: "a\n", args: ["-", "0"], stdout: "", stderr: "csplit: 0: line number must be greater than zero\n", status: 1, files: {} },
  { name: "later invalid numeric", input: "a\nb\n", args: ["-", "2", "oops"], stdout: "", stderr: "csplit: 'oops': invalid pattern\n", status: 1, files: {} },
  { name: "unsigned plus and whitespace", input: "a\nb\n", args: ["-", " +2"], stdout: "2\n2\n", files: { xx00: "a\n", xx01: "b\n" } },
  { name: "escaped percent suffix", input: "a\nb\n", args: ["-fpart", "-b%%-%02x", "-", "2"], stdout: "2\n2\n", files: { "part%-00": "a\n", "part%-01": "b\n" } },
  { name: "octal alternate suffix", input: "a\nb\n", args: ["-b%#03o", "-", "2"], stdout: "2\n2\n", files: { xx000: "a\n", xx001: "b\n" } },
  { name: "suffix absent conversion", input: "a\n", args: ["-bplain", "-", "1"], stdout: "", stderr: "csplit: missing % conversion specification in suffix\n", status: 1, files: {} },
  { name: "suffix two conversions", input: "a\n", args: ["-b%d%d", "-", "1"], stdout: "", stderr: "csplit: too many % conversion specifications in suffix\n", status: 1, files: {} },
  { name: "suffix invalid flags", input: "a\n", args: ["-b%#d", "-", "1"], stdout: "", stderr: "csplit: invalid flags in conversion specification: %#d\n", status: 1, files: {} },
  { name: "suffix string rejected", input: "a\n", args: ["-b%s", "-", "1"], stdout: "", stderr: "csplit: invalid conversion specifier in suffix: s\n", status: 1, files: {} },
];

export const regexCases: readonly Fixture[] = [
  { name: "public malformed later regex", input: "alpha\nbeta\ngamma\n", args: ["-", "2", "/[/"], stdout: "", stderr: "csplit: '/[/': invalid regular expression: Invalid regular expression\n", status: 1, files: {} },
  { name: "regex retain", input: "alpha\nbeta\ngamma\n", args: ["-", "/beta/"], stdout: "6\n11\n", files: { xx00: "alpha\n", xx01: "beta\ngamma\n" } },
  { name: "public positive offset", input: "alpha\nbeta\ngamma\n", args: ["-", "/beta/+1"], stdout: "11\n6\n", files: { xx00: "alpha\nbeta\n", xx01: "gamma\n" } },
  { name: "unsigned positive offset", input: "alpha\nbeta\ngamma\n", args: ["-", "/beta/1"], stdout: "11\n6\n", files: { xx00: "alpha\nbeta\n", xx01: "gamma\n" } },
  { name: "negative offset", input: "alpha\nbeta\ngamma\n", args: ["-", "/beta/-1"], stdout: "0\n17\n", files: { xx00: "", xx01: "alpha\nbeta\ngamma\n" } },
  { name: "skip regex", input: "alpha\nbeta\ngamma\n", args: ["-", "%beta%"], stdout: "11\n", files: { xx00: "beta\ngamma\n" } },
  { name: "regex no match deletes", input: "a\nb\n", args: ["-", "/missing/"], stdout: "4\n", stderr: "csplit: '/missing/': match not found\n", status: 1, files: {} },
  { name: "regex no match keeps", input: "a\nb\n", args: ["-k", "-", "/missing/"], stdout: "4\n", stderr: "csplit: '/missing/': match not found\n", status: 1, files: { xx00: "a\nb\n" } },
  { name: "repeat regex to eof", input: "a\nb\na\nc\n", args: ["-", "/a/", "{*}"], stdout: "0\n4\n4\n", files: { xx00: "", xx01: "a\nb\n", xx02: "a\nc\n" } },
  { name: "unanchored grouped backreference", input: "start\nzaab\nend\n", args: ["-", "/\\(a\\)\\1/"], stdout: "6\n9\n", files: { xx00: "start\n", xx01: "zaab\nend\n" } },
  { name: "CR is subject data", input: "a\r\nb\n", args: ["-", "/b$/"], stdout: "3\n2\n", files: { xx00: "a\r\n", xx01: "b\n" } },
];
