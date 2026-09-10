export const nativeCases = [
  {
    "name": "NUL-prefix-and-invalid-suffix",
    "args": [],
    "inputHex": "30303000626164202b3030303700ff203030313200007878",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 0,
    "stdoutHex": "303a0a373a20370a31323a2032203220330a",
    "stderrHex": ""
  },
  {
    "name": "NUL-only-and-plus",
    "args": [],
    "inputHex": "00200000202b006a756e6b203132",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "31323a2032203220330a",
    "stderrHex": "666163746f723a202727206973206e6f7420612076616c696420706f73697469766520696e74656765720a666163746f723a202727206973206e6f7420612076616c696420706f73697469766520696e74656765720a666163746f723a20272b27206973206e6f7420612076616c696420706f73697469766520696e74656765720a"
  },
  {
    "name": "control-byte-argument",
    "args": [
      "\u0001\t12"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "666163746f723a20275c3030315c3137375c74313227206973206e6f7420612076616c696420706f73697469766520696e74656765720a"
  },
  {
    "name": "BOM-argument",
    "args": [
      "﻿12",
      "18"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "31383a2032203320330a",
    "stderrHex": "666163746f723a20275c3335375c3237335c323737313227206973206e6f7420612076616c696420706f73697469766520696e74656765720a"
  },
  {
    "name": "raw-multibyte-invalid",
    "args": [],
    "inputHex": "8020ff20c3a920c3203132",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "31323a2032203220330a",
    "stderrHex": "666163746f723a20275c32303027206973206e6f7420612076616c696420706f73697469766520696e74656765720a666163746f723a20275c33373727206973206e6f7420612076616c696420706f73697469766520696e74656765720a666163746f723a20275c3330335c32353127206973206e6f7420612076616c696420706f73697469766520696e74656765720a666163746f723a20275c33303327206973206e6f7420612076616c696420706f73697469766520696e74656765720a"
  },
  {
    "name": "raw-quote-NUL-truncation",
    "args": [],
    "inputHex": "626164275c0069676e6f726564203132",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "31323a2032203220330a",
    "stderrHex": "666163746f723a20276261645c275c5c27206973206e6f7420612076616c696420706f73697469766520696e74656765720a"
  },
  {
    "name": "short-bundle",
    "args": [
      "-abc",
      "12"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "666163746f723a20696e76616c6964206f7074696f6e202d2d202761270a5472792027666163746f72202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "empty-long-option",
    "args": [
      "--=x",
      "12"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "666163746f723a206f7074696f6e20272d2d3d782720697320616d626967756f75733b20706f73736962696c69746965733a20272d2d2d64656275672720272d2d68656c702720272d2d76657273696f6e270a5472792027666163746f72202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "full-help-value",
    "args": [
      "--help=x",
      "12"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "666163746f723a206f7074696f6e20272d2d68656c702720646f65736e277420616c6c6f7720616e20617267756d656e740a5472792027666163746f72202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "full-version-empty-value",
    "args": [
      "--version=",
      "12"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "666163746f723a206f7074696f6e20272d2d76657273696f6e2720646f65736e277420616c6c6f7720616e20617267756d656e740a5472792027666163746f72202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "full-debug-empty-value",
    "args": [
      "---debug=",
      "12"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "666163746f723a206f7074696f6e20272d2d2d64656275672720646f65736e277420616c6c6f7720616e20617267756d656e740a5472792027666163746f72202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "minimal-debug-prefix",
    "args": [
      "---",
      "12"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 0,
    "stdoutHex": "31323a2032203220330a",
    "stderrHex": "5b7573696e672073696e676c652d707265636973696f6e2061726974686d657469635d20"
  },
  {
    "name": "end-marker-after-number",
    "args": [
      "12",
      "--",
      "-7",
      "+18"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "31323a2032203220330a31383a2032203320330a",
    "stderrHex": "666163746f723a20272d3727206973206e6f7420612076616c696420706f73697469766520696e74656765720a"
  },
  {
    "name": "POSIX-help-is-operand",
    "args": [
      "12",
      "--help",
      "18"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin",
      "POSIXLY_CORRECT": "1"
    },
    "status": 1,
    "stdoutHex": "31323a2032203220330a31383a2032203320330a",
    "stderrHex": "666163746f723a20272d2d68656c7027206973206e6f7420612076616c696420706f73697469766520696e74656765720a"
  },
  {
    "name": "POSIX-debug-is-operand",
    "args": [
      "12",
      "---debug",
      "18"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin",
      "POSIXLY_CORRECT": ""
    },
    "status": 1,
    "stdoutHex": "31323a2032203220330a31383a2032203320330a",
    "stderrHex": "666163746f723a20272d2d2d646562756727206973206e6f7420612076616c696420706f73697469766520696e74656765720a"
  },
  {
    "name": "late-unknown-before-any-factoring",
    "args": [
      "12",
      "--unknown",
      "bad"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "666163746f723a20756e7265636f676e697a6564206f7074696f6e20272d2d756e6b6e6f776e270a5472792027666163746f72202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "version-after-end-marker",
    "args": [
      "--",
      "--version",
      "12"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "31323a2032203220330a",
    "stderrHex": "666163746f723a20272d2d76657273696f6e27206973206e6f7420612076616c696420706f73697469766520696e74656765720a"
  },
  {
    "name": "uint32-composite-square",
    "args": [
      "4294836225",
      "4293001441"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 0,
    "stdoutHex": "343239343833363232353a203320332035203520313720313720323537203235370a343239333030313434313a2036353532312036353532310a",
    "stderrHex": ""
  },
  {
    "name": "delimiter-at-EOF",
    "args": [],
    "inputHex": "20092b303030330a3030303439093030303120",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 0,
    "stdoutHex": "333a20330a34393a203720370a313a0a",
    "stderrHex": ""
  },
  {
    "name": "space-plus-boundaries",
    "args": [
      " +0002",
      "  +",
      " + 2",
      "2  "
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "323a20320a",
    "stderrHex": "666163746f723a202720202b27206973206e6f7420612076616c696420706f73697469766520696e74656765720a666163746f723a2027202b203227206973206e6f7420612076616c696420706f73697469766520696e74656765720a666163746f723a202732202027206973206e6f7420612076616c696420706f73697469766520696e74656765720a"
  },
  {
    "name": "option-newline-byte",
    "args": [
      "--bad\noption"
    ],
    "inputHex": "",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "666163746f723a20756e7265636f676e697a6564206f7074696f6e20272d2d6261640a6f7074696f6e270a5472792027666163746f72202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "NUL-followed-delimiter-invalid",
    "args": [],
    "inputHex": "31320009626164007375666669780a3138",
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "status": 1,
    "stdoutHex": "31323a2032203220330a31383a2032203320330a",
    "stderrHex": "666163746f723a202762616427206973206e6f7420612076616c696420706f73697469766520696e74656765720a"
  }
] as const;

