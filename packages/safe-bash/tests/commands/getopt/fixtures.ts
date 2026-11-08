export interface NativeCase { readonly name: string; readonly argsHex: readonly string[]; readonly env: Readonly<Record<string,string>>; readonly stdinHex: string; readonly status: number; readonly stdoutHex: string; readonly stderrHex: string; }

export const nativeCases: readonly NativeCase[] = [
  {
    "name": "required-subset",
    "argsHex": [
      "2d6f",
      "61623a633a3a",
      "2d2d6c6f6e67",
      "616c7068612c626574613a2c636f6c6f723a3a",
      "2d2d",
      "707265",
      "2d2d616c7068",
      "2d62",
      "76616c7565",
      "2d2d636f6c6f72",
      "2d2d",
      "2d61",
      ""
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d616c706861202d62202776616c756527202d2d636f6c6f72202727202d2d20277072652720272d61272027270a",
    "stderrHex": ""
  },
  {
    "name": "quoting",
    "argsHex": [
      "2d6f",
      "",
      "2d2d",
      "",
      "612062",
      "4f275265696c6c79",
      "6c696e650a6e657874",
      "7461620968657265",
      "5c246021223b24286e6f7468696e6729"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d20272720276120622720274f275c27275265696c6c792720276c696e650a6e65787427202774616209686572652720275c246021223b24286e6f7468696e6729270a",
    "stderrHex": ""
  },
  {
    "name": "short-optional",
    "argsHex": [
      "2d6f",
      "6f3a3a",
      "2d2d",
      "2d6f76",
      "2d6f",
      "6e657874",
      "2d6f3d6571"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d6f20277627202d6f202727202d6f20273d657127202d2d20276e657874270a",
    "stderrHex": ""
  },
  {
    "name": "long-optional",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "636f6c6f723a3a",
      "2d2d",
      "2d2d636f6c6f72",
      "6e657874",
      "2d2d636f6c6f723d",
      "2d2d636f6c6f723d726564"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d636f6c6f72202727202d2d636f6c6f72202727202d2d636f6c6f72202772656427202d2d20276e657874270a",
    "stderrHex": ""
  },
  {
    "name": "required-terminator-value",
    "argsHex": [
      "2d6f",
      "623a",
      "2d6c",
      "626574613a",
      "2d2d",
      "2d62",
      "2d2d",
      "2d2d62657461",
      "2d78"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d6220272d2d27202d2d6265746120272d7827202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "long-abbrev",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "666f6f2c666f6f626172",
      "2d2d",
      "2d2d666f6f",
      "2d2d666f6f62"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d666f6f202d2d666f6f626172202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "ambiguous",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "636f6c6f722c636f756e74",
      "2d2d",
      "2d2d636f",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": "6765746f70743a206f7074696f6e20272d2d636f2720697320616d626967756f75733b20706f73736962696c69746965733a20272d2d636f6c6f722720272d2d636f756e74270a"
  },
  {
    "name": "duplicate-prefix",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "616c7068612c616c706861",
      "2d2d",
      "2d2d616c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d0a",
    "stderrHex": "6765746f70743a206f7074696f6e20272d2d616c2720697320616d626967756f75733b20706f73736962696c69746965733a20272d2d616c7068612720272d2d616c706861270a"
  },
  {
    "name": "duplicate-exact",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "616c7068612c616c7068613a",
      "2d2d",
      "2d2d616c706861",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d616c706861202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "no-arg-value",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "616c706861",
      "2d2d",
      "2d2d616c7068613d78",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": "6765746f70743a206f7074696f6e20272d2d616c7068612720646f65736e277420616c6c6f7720616e20617267756d656e740a"
  },
  {
    "name": "missing-short",
    "argsHex": [
      "2d6f",
      "613a62",
      "2d2d",
      "2d62",
      "2d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d62202d2d0a",
    "stderrHex": "6765746f70743a206f7074696f6e20726571756972657320616e20617267756d656e74202d2d202761270a"
  },
  {
    "name": "missing-long",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "616c7068613a",
      "2d2d",
      "2d2d616c706861"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d0a",
    "stderrHex": "6765746f70743a206f7074696f6e20272d2d616c7068612720726571756972657320616e20617267756d656e740a"
  },
  {
    "name": "unknown-cluster",
    "argsHex": [
      "2d6f",
      "6162",
      "2d2d",
      "2d617862",
      "2d2d756e6b6e6f776e",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d61202d62202d2d20277461696c270a",
    "stderrHex": "6765746f70743a20696e76616c6964206f7074696f6e202d2d202778270a6765746f70743a20756e7265636f676e697a6564206f7074696f6e20272d2d756e6b6e6f776e270a"
  },
  {
    "name": "quiet-errors",
    "argsHex": [
      "2d71",
      "2d6f",
      "6162",
      "2d2d",
      "2d617862",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d61202d62202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "quiet-output",
    "argsHex": [
      "2d51",
      "2d6f",
      "6162",
      "2d2d",
      "2d617862",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "6765746f70743a20696e76616c6964206f7074696f6e202d2d202778270a"
  },
  {
    "name": "quiet-both",
    "argsHex": [
      "2d7151",
      "2d6f",
      "",
      "2d2d",
      "2d2d626164"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "",
    "stderrHex": ""
  },
  {
    "name": "diagnostic-name",
    "argsHex": [
      "2d6e",
      "706172736572",
      "2d6f",
      "",
      "2d2d",
      "2d2d626164"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d0a",
    "stderrHex": "7061727365723a20756e7265636f676e697a6564206f7074696f6e20272d2d626164270a"
  },
  {
    "name": "missing-optstring",
    "argsHex": [],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "6765746f70743a206d697373696e67206f7074737472696e6720617267756d656e740a54727920276765746f7074202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "missing-wrapper-arg",
    "argsHex": [
      "2d6f"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "6765746f70743a206f7074696f6e20726571756972657320616e20617267756d656e74202d2d20276f270a54727920276765746f7074202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "unknown-wrapper-option",
    "argsHex": [
      "2d2d626164"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "6765746f70743a20756e7265636f676e697a6564206f7074696f6e20272d2d626164270a54727920276765746f7074202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "empty-long-name",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "3a3a",
      "2d2d"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "6765746f70743a20656d707479206c6f6e67206f7074696f6e206166746572202d6c206f72202d2d6c6f6e6720617267756d656e740a54727920276765746f7074202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "test-version",
    "argsHex": [
      "2d54"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 4,
    "stdoutHex": "",
    "stderrHex": ""
  },
  {
    "name": "default-permute",
    "argsHex": [
      "2d6f",
      "61623a",
      "2d2d",
      "6669727374",
      "2d61",
      "6d6964646c65",
      "2d62",
      "76616c7565",
      "6c617374"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d61202d62202776616c756527202d2d202766697273742720276d6964646c652720276c617374270a",
    "stderrHex": ""
  },
  {
    "name": "plus-stop",
    "argsHex": [
      "2d6f",
      "2b61623a",
      "2d2d",
      "6669727374",
      "2d61",
      "6d6964646c65",
      "2d62",
      "76616c7565",
      "6c617374"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d202766697273742720272d612720276d6964646c652720272d6227202776616c75652720276c617374270a",
    "stderrHex": ""
  },
  {
    "name": "minus-in-order",
    "argsHex": [
      "2d6f",
      "2d61623a",
      "2d2d",
      "6669727374",
      "2d61",
      "6d6964646c65",
      "2d62",
      "76616c7565",
      "6c617374"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "2027666972737427202d6120276d6964646c6527202d62202776616c75652720276c61737427202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "posix-empty",
    "argsHex": [
      "2d6f",
      "61",
      "2d2d",
      "6669727374",
      "2d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "POSIXLY_CORRECT": ""
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d202766697273742720272d61270a",
    "stderrHex": ""
  },
  {
    "name": "minus-overrides-posix",
    "argsHex": [
      "2d6f",
      "2d61",
      "2d2d",
      "6669727374",
      "2d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "POSIXLY_CORRECT": "1"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "2027666972737427202d61202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "compatible-empty",
    "argsHex": [],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "GETOPT_COMPATIBLE": ""
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "compatible-test",
    "argsHex": [
      "2d54"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "GETOPT_COMPATIBLE": "1"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "legacy-unquoted",
    "argsHex": [
      "61623a",
      "2d61",
      "2d62",
      "612062",
      ""
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d61202d6220612062202d2d200a",
    "stderrHex": ""
  },
  {
    "name": "unquoted",
    "argsHex": [
      "2d75",
      "2d6f",
      "",
      "2d2d",
      "612062",
      ""
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d20612062200a",
    "stderrHex": ""
  },
  {
    "name": "tcsh-quoting",
    "argsHex": [
      "2d73",
      "74637368",
      "2d6f",
      "",
      "2d2d",
      "612762",
      "612062",
      "610962",
      "610a62",
      "612162",
      "615c62"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d202761275c27276227202761275c20276227202761275c092762272027615c6e6227202761275c212762272027615c5c62270a",
    "stderrHex": ""
  },
  {
    "name": "invalid-shell",
    "argsHex": [
      "2d73",
      "66697368",
      "2d6f",
      "",
      "2d2d"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "6765746f70743a20756e6b6e6f776e207368656c6c206166746572202d73206f72202d2d7368656c6c20617267756d656e740a54727920276765746f7074202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "long-only",
    "argsHex": [
      "2d61",
      "2d6f",
      "663a",
      "2d6c",
      "66756261723a",
      "2d2d",
      "2d66",
      "6f6e65",
      "2d66753d74776f"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d6620276f6e6527202d2d6675626172202774776f27202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "silent-colon",
    "argsHex": [
      "2d6f",
      "3a613a",
      "2d2d",
      "2d78",
      "2d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "repeat-schema",
    "argsHex": [
      "2d6f",
      "7a",
      "2d6f",
      "61",
      "2d6c",
      "6669727374",
      "2d6c",
      "7365636f6e64",
      "2d2d",
      "2d61",
      "2d2d6669727374",
      "2d2d7365636f6e64"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d61202d2d6669727374202d2d7365636f6e64202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "schema-separators",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "616c7068612c20626574613a0967616d6d613a3a0a",
      "2d2d",
      "2d2d616c706861",
      "2d2d626574613d78",
      "2d2d67616d6d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d616c706861202d2d6265746120277827202d2d67616d6d61202727202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "wrapper-fallback-optstring",
    "argsHex": [
      "2d2d6c6f6e67",
      "616c706861",
      "61",
      "2d2d616c706861",
      "2d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d616c706861202d61202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "W-long-extension",
    "argsHex": [
      "2d6f",
      "573b",
      "2d6c",
      "616c7068613a",
      "2d2d",
      "2d57",
      "616c7068613d78"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d616c70686120277827202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "stdin-ignored",
    "argsHex": [
      "2d6f",
      "",
      "2d2d"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "stdinHex": "2d2d756e6b6e6f776e0a",
    "status": 0,
    "stdoutHex": "202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "legacy-plus-stripped",
    "argsHex": [
      "2b61",
      "6669727374",
      "2d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d61202d2d2066697273740a",
    "stderrHex": ""
  },
  {
    "name": "compatible-sign-run",
    "argsHex": [
      "2d2b2d2b61",
      "6669727374",
      "2d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin",
      "GETOPT_COMPATIBLE": ""
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d61202d2d2066697273740a",
    "stderrHex": ""
  },
  {
    "name": "compatible-modern-looking",
    "argsHex": [
      "2d6f",
      "61",
      "2d2d",
      "2d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin",
      "GETOPT_COMPATIBLE": ""
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d2061202d610a",
    "stderrHex": ""
  },
  {
    "name": "wrapper-quiet-not-wrapper-errors",
    "argsHex": [
      "2d71",
      "2d2d626164"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "6765746f70743a20756e7265636f676e697a6564206f7074696f6e20272d2d626164270a54727920276765746f7074202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "test-short-circuits-later-error",
    "argsHex": [
      "2d54",
      "2d2d626164"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 4,
    "stdoutHex": "",
    "stderrHex": ""
  },
  {
    "name": "wrapper-error-before-test",
    "argsHex": [
      "2d73",
      "66697368",
      "2d54"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "6765746f70743a20756e6b6e6f776e207368656c6c206166746572202d73206f72202d2d7368656c6c20617267756d656e740a54727920276765746f7074202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "empty-target-prefix",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "616c7068612c62657461",
      "2d2d",
      "2d2d3d78",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": "6765746f70743a206f7074696f6e20272d2d3d782720697320616d626967756f75733b20706f73736962696c69746965733a20272d2d616c7068612720272d2d62657461270a"
  },
  {
    "name": "empty-wrapper-prefix",
    "argsHex": [
      "2d2d3d78"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "6765746f70743a206f7074696f6e20272d2d3d782720697320616d626967756f75733b20706f73736962696c69746965733a20272d2d6f7074696f6e732720272d2d6c6f6e676f7074696f6e732720272d2d71756965742720272d2d71756965742d6f75747075742720272d2d7368656c6c2720272d2d746573742720272d2d756e71756f7465642720272d2d68656c702720272d2d616c7465726e61746976652720272d2d6e616d652720272d2d76657273696f6e270a54727920276765746f7074202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "declared-question-sentinel",
    "argsHex": [
      "2d6f",
      "3f",
      "2d2d",
      "2d3f",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "declared-code-one-sentinel",
    "argsHex": [
      "2d6f",
      "01",
      "2d2d",
      "2d01",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202727202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "ordering-prefix-short-plus-required",
    "argsHex": [
      "2d6f",
      "2b612b3a",
      "2d2d",
      "2d2b76616c7565",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2b202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "leading-colon-after-plus",
    "argsHex": [
      "2d6f",
      "2b3a613a",
      "2d2d",
      "2d78",
      "2d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "minus-colon-return-order",
    "argsHex": [
      "2d6f",
      "2d3a613a",
      "2d2d",
      "6669727374",
      "2d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin",
      "POSIXLY_CORRECT": ""
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "2027666972737427202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "long-only-short-first-fallback",
    "argsHex": [
      "2d61",
      "2d6f",
      "61623a",
      "2d6c",
      "6170706c65",
      "2d2d",
      "2d616256414c5545",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d61202d62202756414c554527202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "long-only-prefix-wins-cluster",
    "argsHex": [
      "2d61",
      "2d6f",
      "6162",
      "2d6c",
      "61626f7574",
      "2d2d",
      "2d6162",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d61626f7574202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "long-only-ambiguous-prefix",
    "argsHex": [
      "2d61",
      "2d6f",
      "61",
      "2d6c",
      "6170706c652c61707269636f74",
      "2d2d",
      "2d61703d6672756974",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": "6765746f70743a206f7074696f6e20272d61703d66727569742720697320616d626967756f75733b20706f73736962696c69746965733a20272d6170706c652720272d61707269636f74270a"
  },
  {
    "name": "W-unknown",
    "argsHex": [
      "2d6f",
      "573b",
      "2d6c",
      "616c706861",
      "2d2d",
      "2d57",
      "756e6b6e6f776e",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": "6765746f70743a20756e7265636f676e697a6564206f7074696f6e20272d5720756e6b6e6f776e270a"
  },
  {
    "name": "W-ambiguous",
    "argsHex": [
      "2d6f",
      "573b",
      "2d6c",
      "616c7068612c616c70696e65",
      "2d2d",
      "2d57616c",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": "6765746f70743a206f7074696f6e20272d5720616c2720697320616d626967756f75733b20706f73736962696c69746965733a20272d5720616c7068612720272d5720616c70696e65270a"
  },
  {
    "name": "W-missing",
    "argsHex": [
      "2d6f",
      "573b",
      "2d2d",
      "2d57"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d0a",
    "stderrHex": "6765746f70743a206f7074696f6e20726571756972657320616e20617267756d656e74202d2d202757270a"
  },
  {
    "name": "schema-CR-VT-retained",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "616c7068610d626574612c0b666f6f",
      "2d2d",
      "2d2d616c7068610d62657461",
      "2d2d0b666f6f"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d616c7068610d62657461202d2d0b666f6f202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "triple-colon-schema",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "6e616d653a3a3a",
      "2d2d",
      "2d2d6e616d653a3d796573"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d6e616d653a202779657327202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "tcsh-controls-raw",
    "argsHex": [
      "2d73",
      "637368",
      "2d6f",
      "",
      "2d2d",
      "610d62",
      "610b62",
      "610c62",
      "80ff",
      "c3a9"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d202761275c0d276227202761275c0b276227202761275c0c276227202780ff272027c3a9270a",
    "stderrHex": ""
  },
  {
    "name": "bash-high-byte-raw",
    "argsHex": [
      "2d6f",
      "",
      "2d2d",
      "80ff",
      "6127ff5c0a"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d202780ff27202761275c2727ff5c0a270a",
    "stderrHex": ""
  },
  {
    "name": "raw-short-ff-defined",
    "argsHex": [
      "2d6f",
      "ff",
      "2d2d",
      "2dff",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 0,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "raw-short-ff-unknown",
    "argsHex": [
      "2d6f",
      "",
      "2d2d",
      "2dff",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": "6765746f70743a20696e76616c6964206f7074696f6e202d2d2027ff270a"
  },
  {
    "name": "raw-diagnostic-name",
    "argsHex": [
      "2d6e",
      "706172736572ff0a",
      "2d6f",
      "",
      "2d2d",
      "2d2d626164ff"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d0a",
    "stderrHex": "706172736572ff0a3a20756e7265636f676e697a6564206f7074696f6e20272d2d626164ff270a"
  },
  {
    "name": "nonempty-name-replaced-last",
    "argsHex": [
      "2d6e",
      "6f6c64",
      "2d6e",
      "6e6577",
      "2d6f",
      "",
      "2d2d",
      "2d2d626164"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d0a",
    "stderrHex": "6e65773a20756e7265636f676e697a6564206f7074696f6e20272d2d626164270a"
  },
  {
    "name": "empty-name",
    "argsHex": [
      "2d6e",
      "",
      "2d6f",
      "",
      "2d2d",
      "2d2d626164"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d0a",
    "stderrHex": "3a20756e7265636f676e697a6564206f7074696f6e20272d2d626164270a"
  },
  {
    "name": "quiet-colon-long-ambiguity",
    "argsHex": [
      "2d6f",
      "3a",
      "2d6c",
      "666f6f2c666f6f64",
      "2d2d",
      "2d2d666f",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "wrapper-stops-at-fallback-optstring",
    "argsHex": [
      "2d6c",
      "616c706861",
      "61",
      "2d51",
      "2d61",
      "2d2d616c706861"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "stdinHex": "",
    "status": 1,
    "stdoutHex": "202d61202d2d616c706861202d2d0a",
    "stderrHex": "6765746f70743a20696e76616c6964206f7074696f6e202d2d202751270a"
  }
];
