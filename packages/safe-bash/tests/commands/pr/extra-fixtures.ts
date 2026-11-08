export const extraCases = [
  {
    "name": "directory-first",
    "args": [
      "-t",
      "directory",
      "a"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a206469726563746f72793a2049732061206469726563746f72790a",
    "status": 1
  },
  {
    "name": "directory-last",
    "args": [
      "-t",
      "a",
      "directory"
    ],
    "inputHex": "",
    "stdoutHex": "610a620a630a640a",
    "stderrHex": "70723a206469726563746f72793a2049732061206469726563746f72790a",
    "status": 1
  },
  {
    "name": "merge-directory",
    "args": [
      "-t",
      "-m",
      "a",
      "directory"
    ],
    "inputHex": "",
    "stdoutHex": "61",
    "stderrHex": "70723a206469726563746f72793a2049732061206469726563746f72790a",
    "status": 1
  },
  {
    "name": "missing-apostrophe",
    "args": [
      "-t",
      "not'found"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a20226e6f7427666f756e64223a204e6f20737563682066696c65206f72206469726563746f72790a",
    "status": 1
  },
  {
    "name": "missing-space",
    "args": [
      "-t",
      "not found"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a20276e6f7420666f756e64273a204e6f20737563682066696c65206f72206469726563746f72790a",
    "status": 1
  },
  {
    "name": "missing-control",
    "args": [
      "-t",
      "not\tfound"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a20276e6f742724275c742727666f756e64273a204e6f20737563682066696c65206f72206469726563746f72790a",
    "status": 1
  },
  {
    "name": "missing-unicode",
    "args": [
      "-t",
      "é"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a20272724275c3330335c323531273a204e6f20737563682066696c65206f72206469726563746f72790a",
    "status": 1
  },
  {
    "name": "invalid-number-control",
    "args": [
      "-l",
      "a\tb"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a20272d6c20504147455f4c454e4754482720696e76616c6964206e756d626572206f66206c696e65733a2027615c7462270a",
    "status": 1
  },
  {
    "name": "invalid-number-apostrophe",
    "args": [
      "-w",
      "a'b"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a20272d7720504147455f57494454482720696e76616c6964206e756d626572206f6620636861726163746572733a2027615c2762270a",
    "status": 1
  },
  {
    "name": "across",
    "args": [
      "-t",
      "-2",
      "-a",
      "-w9",
      "a"
    ],
    "inputHex": "",
    "stdoutHex": "6120202020620a6320202020640a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "double-space",
    "args": [
      "-t",
      "-d",
      "a"
    ],
    "inputHex": "",
    "stdoutHex": "610a0a620a0a630a0a640a0a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "double-paginated",
    "args": [
      "-l14",
      "-d",
      "a"
    ],
    "inputHex": "",
    "stdoutHex": "0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520310a0a0a610a0a620a0a0a0a0a0a0a0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520320a0a0a630a0a640a0a0a0a0a0a0a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "formfeed-output",
    "args": [
      "-l12",
      "-F",
      "a"
    ],
    "inputHex": "",
    "stdoutHex": "0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520310a0a0a610a620a0c0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520320a0a0a630a640a0c",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "omit-pagination",
    "args": [
      "-T"
    ],
    "inputHex": "610c620c0c630a",
    "stdoutHex": "610a620a630a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "indent",
    "args": [
      "-t",
      "-n:2",
      "-o2",
      "a"
    ],
    "inputHex": "",
    "stdoutHex": "202020313a610a202020323a620a202020333a630a202020343a640a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "control-prefix",
    "args": [
      "-t",
      "-c"
    ],
    "inputHex": "000708090d1b7fff0a",
    "stdoutHex": "5e405e475e48095e4d5e5b5e3f5c3337370a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "octal",
    "args": [
      "-t",
      "-v"
    ],
    "inputHex": "000708090d1b7fff0a",
    "stdoutHex": "5c3030305c3030375c303130095c3031355c3033335c3137375c3337370a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "expand-tabs",
    "args": [
      "-t",
      "-e4"
    ],
    "inputHex": "6109620a",
    "stdoutHex": "61202020620a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "output-tabs",
    "args": [
      "-t",
      "-i4"
    ],
    "inputHex": "612020206220200a",
    "stdoutHex": "6109620a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "custom-tabs",
    "args": [
      "-t",
      "-e:4"
    ],
    "inputHex": "613a620a",
    "stdoutHex": "61202020620a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "wide-truncate",
    "args": [
      "-t",
      "-W2"
    ],
    "inputHex": "6162636465660a",
    "stdoutHex": "61620a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "join-overrides",
    "args": [
      "-t",
      "-2",
      "-W2",
      "-J",
      "a"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a207061676520776964746820746f6f206e6172726f770a",
    "status": 1
  },
  {
    "name": "number-negative",
    "args": [
      "-t",
      "-N-2",
      "-n:2",
      "a"
    ],
    "inputHex": "",
    "stdoutHex": "2d323a610a2d313a620a20303a630a20313a640a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "quiet-missing",
    "args": [
      "-t",
      "-r",
      "missing",
      "b"
    ],
    "inputHex": "",
    "stdoutHex": "420a",
    "stderrHex": "",
    "status": 1
  },
  {
    "name": "separator-string",
    "args": [
      "-t",
      "-2",
      "-S|",
      "-w9",
      "a"
    ],
    "inputHex": "",
    "stdoutHex": "612020207c630a622020207c640a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "short-required",
    "args": [
      "-h"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a206f7074696f6e20726571756972657320616e20617267756d656e74202d2d202768270a54727920277072202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a",
    "status": 1
  },
  {
    "name": "long-required",
    "args": [
      "--length"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a206f7074696f6e20272d2d6c656e6774682720726571756972657320616e20617267756d656e740a54727920277072202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a",
    "status": 1
  },
  {
    "name": "long-noarg-value",
    "args": [
      "--merge=x"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a206f7074696f6e20272d2d6d657267652720646f65736e277420616c6c6f7720616e20617267756d656e740a54727920277072202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a",
    "status": 1
  },
  {
    "name": "leading-whitespace-number",
    "args": [
      "-t",
      "-l",
      " +2",
      "a"
    ],
    "inputHex": "",
    "stdoutHex": "610a620a630a640a",
    "stderrHex": "",
    "status": 0
  },
  {
    "name": "invalid-suffix-number",
    "args": [
      "-t",
      "-l",
      "2x"
    ],
    "inputHex": "",
    "stdoutHex": "",
    "stderrHex": "70723a20272d6c20504147455f4c454e4754482720696e76616c6964206e756d626572206f66206c696e65733a20273278270a",
    "status": 1
  }
];
