import type { Fixture } from "./fixtures.js";

export const extendedCases: readonly Fixture[] = [
  {
    "name": "offset-past-end",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/b/+99"
    ],
    "stdout": "12\n",
    "stderr": "csplit: '/b/+99': line number out of range\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "offset-before-begin",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/a/-1"
    ],
    "stdout": "0\n",
    "stderr": "csplit: '/a/-1': line number out of range\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "separate-negative-cursors",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/a/",
      "/a/-1"
    ],
    "stdout": "0\n2\n10\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx02": "b\na\nc\na\nd\n",
      "xx00": "",
      "xx01": "a\n"
    }
  },
  {
    "name": "positive-repeat",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/a/+1",
      "{*}"
    ],
    "stdout": "2\n4\n4\n2\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx03": "d\n",
      "xx02": "c\na\n",
      "xx00": "a\n",
      "xx01": "b\na\n"
    }
  },
  {
    "name": "negative-repeat",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/a/-1",
      "{*}"
    ],
    "stdout": "0\n",
    "stderr": "csplit: '/a/-1': line number out of range\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "zero-repeat",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "//",
      "{*}"
    ],
    "stdout": "0\n2\n2\n2\n2\n2\n2\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx03": "a\n",
      "xx02": "b\n",
      "xx05": "a\n",
      "xx04": "c\n",
      "xx00": "",
      "xx01": "a\n",
      "xx06": "d\n"
    }
  },
  {
    "name": "skip-repeat",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "%a%",
      "{*}"
    ],
    "stdout": "",
    "stderr": "",
    "status": 0,
    "files": {}
  },
  {
    "name": "skip-negative-repeat",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "%a%-1",
      "{*}"
    ],
    "stdout": "",
    "stderr": "csplit: '%a%-1': line number out of range\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "skip-offset-tail",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "%b%+1"
    ],
    "stdout": "8\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx00": "a\nc\na\nd\n"
    }
  },
  {
    "name": "late-ignore-failure",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "2",
      "%missing%"
    ],
    "stdout": "2\n",
    "stderr": "csplit: '%missing%': match not found\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "repeat-regex-missing",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/b/",
      "{1}"
    ],
    "stdout": "2\n10\n",
    "stderr": "csplit: '/b/': match not found on repetition 1\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "forever-skips-later",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/missing/",
      "{*}",
      "9"
    ],
    "stdout": "12\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx00": "a\nb\na\nc\na\nd\n"
    }
  },
  {
    "name": "absolute-after-repeat",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "2",
      "{2}",
      "3"
    ],
    "stdout": "2\n4\n4\n0\n2\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx03": "",
      "xx02": "c\na\n",
      "xx04": "d\n",
      "xx00": "a\n",
      "xx01": "b\na\n"
    }
  },
  {
    "name": "regex-then-backward-numeric",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/c/",
      "2"
    ],
    "stdout": "6\n0\n6\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx02": "c\na\nd\n",
      "xx00": "a\nb\na\n",
      "xx01": ""
    }
  },
  {
    "name": "keep-repeat-failure",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-k",
      "-",
      "/b/",
      "{1}"
    ],
    "stdout": "2\n10\n",
    "stderr": "csplit: '/b/': match not found on repetition 1\n",
    "status": 1,
    "files": {
      "xx00": "a\n",
      "xx01": "b\na\nc\na\nd\n"
    }
  },
  {
    "name": "literal-slash",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/a/b/"
    ],
    "stdout": "12\n",
    "stderr": "csplit: '/a/b/': match not found\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "escaped-slash",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/a\\/b/"
    ],
    "stdout": "12\n",
    "stderr": "csplit: '/a\\\\/b/': match not found\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "empty-regex-eof",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "//",
      "{6}"
    ],
    "stdout": "0\n2\n2\n2\n2\n2\n2\n",
    "stderr": "csplit: '//': match not found on repetition 6\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "keep-empty-regex-eof",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-k",
      "-",
      "//",
      "{6}"
    ],
    "stdout": "0\n2\n2\n2\n2\n2\n2\n",
    "stderr": "csplit: '//': match not found on repetition 6\n",
    "status": 1,
    "files": {
      "xx03": "a\n",
      "xx02": "b\n",
      "xx05": "a\n",
      "xx04": "c\n",
      "xx00": "",
      "xx01": "a\n",
      "xx06": "d\n"
    }
  },
  {
    "name": "repeat-missing-close",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "2",
      "{3"
    ],
    "stdout": "",
    "stderr": "csplit: '{3': '}' is required in repeat count\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "repeat-invalid",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "2",
      "{bad}"
    ],
    "stdout": "",
    "stderr": "csplit: '{bad'}: integer required between '{' and '}'\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "repeat-negative",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "2",
      "{-1}"
    ],
    "stdout": "",
    "stderr": "csplit: '{-1'}: integer required between '{' and '}'\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "repeat-extra",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "2",
      "{0}",
      "{0}"
    ],
    "stdout": "",
    "stderr": "csplit: '{0}': invalid pattern\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "delimiter-missing",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/a"
    ],
    "stdout": "",
    "stderr": "csplit: /a: closing delimiter '/' missing\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "invalid-offset",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/a/hi"
    ],
    "stdout": "",
    "stderr": "csplit: '/a/hi': integer expected after delimiter\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "invalid-later-bracket",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "2",
      "/[a/"
    ],
    "stdout": "",
    "stderr": "csplit: '/[a/': invalid regular expression: Unmatched [, [^, [:, [., or [=\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "bad-interval",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/a\\{3,2\\}/"
    ],
    "stdout": "",
    "stderr": "csplit: '/a\\\\{3,2\\\\}/': invalid regular expression: Invalid content of \\{\\}\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "bad-backref",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "/\\1/"
    ],
    "stdout": "",
    "stderr": "csplit: '/\\\\1/': invalid regular expression: Invalid back reference\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "missing-operand",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [],
    "stdout": "",
    "stderr": "csplit: missing operand\nTry 'csplit --help' for more information.\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "missing-pattern",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "input"
    ],
    "stdout": "",
    "stderr": "csplit: missing operand after 'input'\nTry 'csplit --help' for more information.\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "unknown",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "--bad"
    ],
    "stdout": "",
    "stderr": "csplit: unrecognized option '--bad'\nTry 'csplit --help' for more information.\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "missing-prefix",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-f"
    ],
    "stdout": "",
    "stderr": "csplit: option requires an argument -- 'f'\nTry 'csplit --help' for more information.\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "short-flags",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-zk",
      "-f",
      "chunk",
      "-b",
      "%04u",
      "-",
      "1"
    ],
    "stdout": "12\n",
    "stderr": "",
    "status": 0,
    "files": {
      "chunk0000": "a\nb\na\nc\na\nd\n"
    }
  },
  {
    "name": "long-abbrev",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "--pref=x",
      "--elide",
      "-",
      "1"
    ],
    "stdout": "12\n",
    "stderr": "",
    "status": 0,
    "files": {
      "x00": "a\nb\na\nc\na\nd\n"
    }
  },
  {
    "name": "option-permutation",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-",
      "2",
      "-fafter"
    ],
    "stdout": "2\n10\n",
    "stderr": "",
    "status": 0,
    "files": {
      "after01": "b\na\nc\na\nd\n",
      "after00": "a\n"
    }
  },
  {
    "name": "quiet",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-q",
      "-",
      "2"
    ],
    "stdout": "",
    "stderr": "",
    "status": 0,
    "files": {
      "xx00": "a\n",
      "xx01": "b\na\nc\na\nd\n"
    }
  },
  {
    "name": "digits-zero",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-n0",
      "-",
      "2"
    ],
    "stdout": "2\n10\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx1": "b\na\nc\na\nd\n",
      "xx0": "a\n"
    }
  },
  {
    "name": "precision-zero",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-b%.0d",
      "-",
      "2"
    ],
    "stdout": "2\n10\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx1": "b\na\nc\na\nd\n",
      "xx": "a\n"
    }
  },
  {
    "name": "padded-left",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-b%-4d",
      "-",
      "2"
    ],
    "stdout": "2\n10\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx1   ": "b\na\nc\na\nd\n",
      "xx0   ": "a\n"
    }
  },
  {
    "name": "hex-alternate",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-b%#04x",
      "-",
      "2"
    ],
    "stdout": "2\n10\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx0x01": "b\na\nc\na\nd\n",
      "xx0000": "a\n"
    }
  },
  {
    "name": "suffix-missing-spec",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-b%",
      "-",
      "2"
    ],
    "stdout": "",
    "stderr": "csplit: missing conversion specifier in suffix\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "suffix-only-percent",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-b%%",
      "-",
      "2"
    ],
    "stdout": "",
    "stderr": "csplit: missing % conversion specification in suffix\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "suffix-star-width",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-b%*d",
      "-",
      "2"
    ],
    "stdout": "",
    "stderr": "csplit: invalid conversion specifier in suffix: *\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "suffix-plus-flag",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-b%+d",
      "-",
      "2"
    ],
    "stdout": "",
    "stderr": "csplit: invalid conversion specifier in suffix: +\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "suffix-precision",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-b%8.4d",
      "-",
      "2"
    ],
    "stdout": "2\n10\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx    0000": "a\n",
      "xx    0001": "b\na\nc\na\nd\n"
    }
  },
  {
    "name": "suppress-numeric",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "--suppress-matched",
      "-",
      "2"
    ],
    "stdout": "2\n8\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx00": "a\n",
      "xx01": "a\nc\na\nd\n"
    }
  },
  {
    "name": "suppress-regex",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "--suppress-matched",
      "-",
      "/a/",
      "{*}"
    ],
    "stdout": "0\n2\n2\n2\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx03": "d\n",
      "xx02": "c\n",
      "xx00": "",
      "xx01": "b\n"
    }
  },
  {
    "name": "missing-prefix-parent",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "-fmissing/out",
      "-",
      "2"
    ],
    "stdout": "",
    "stderr": "csplit: missing/out00: No such file or directory\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "missing-input",
    "input": "a\nb\na\nc\na\nd\n",
    "args": [
      "absent",
      "2"
    ],
    "stdout": "",
    "stderr": "csplit: cannot open 'absent' for reading: No such file or directory\n",
    "status": 1,
    "files": {}
  },
  {
    "name": "suffix-growth",
    "input": "a\na\na\na\na\na\na\na\na\na\na\na\na\na\n",
    "args": [
      "-n1",
      "-",
      "1",
      "{10}"
    ],
    "stdout": "0\n2\n2\n2\n2\n2\n2\n2\n2\n2\n2\n8\n",
    "stderr": "",
    "status": 0,
    "files": {
      "xx2": "a\n",
      "xx11": "a\na\na\na\n",
      "xx1": "a\n",
      "xx7": "a\n",
      "xx6": "a\n",
      "xx4": "a\n",
      "xx3": "a\n",
      "xx9": "a\n",
      "xx0": "",
      "xx5": "a\n",
      "xx8": "a\n",
      "xx10": "a\n"
    }
  }
];
