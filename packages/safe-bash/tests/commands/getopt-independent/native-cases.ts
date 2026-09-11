export const nativeCases = [
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
    "status": 1,
    "stdoutHex": "202d61202d2d616c706861202d2d0a",
    "stderrHex": "6765746f70743a20696e76616c6964206f7074696f6e202d2d202751270a"
  },
  {
    "name": "ff-after-operand",
    "argsHex": [
      "2d6f",
      "ff",
      "2d2d",
      "707265",
      "2dff",
      "7461696c"
    ],
    "env": {},
    "status": 0,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "ff-cluster-after-operand",
    "argsHex": [
      "2d6f",
      "ff61",
      "2d2d",
      "707265",
      "2dff61",
      "7461696c"
    ],
    "env": {},
    "status": 0,
    "stdoutHex": "202d2d20272dff612720277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "ff-after-option",
    "argsHex": [
      "2d6f",
      "61ff",
      "2d2d",
      "707265",
      "2d61",
      "6d6964",
      "2dff",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d61202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "ff-cluster-after-option",
    "argsHex": [
      "2d6f",
      "61ff",
      "2d2d",
      "707265",
      "2d61",
      "6d6964",
      "2dff61",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d61202d2d20272dff612720277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "ff-attached-required",
    "argsHex": [
      "2d6f",
      "ff3a",
      "2d2d",
      "707265",
      "2dff76616c7565",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "ff-separate-required",
    "argsHex": [
      "2d6f",
      "ff3a",
      "2d2d",
      "707265",
      "2dff",
      "76616c7565",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "ff-return-order",
    "argsHex": [
      "2d6f",
      "2dff61",
      "2d2d",
      "707265",
      "2dff61",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202770726527202d2d20272dff612720277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "W-cluster-after-short",
    "argsHex": [
      "2d6f",
      "61573b623a",
      "2d6c",
      "616c7068613a",
      "2d2d",
      "707265",
      "2d6157616c706861",
      "2d2d",
      "2d6256",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d61202d2d616c70686120272d2d27202d6220275627202d2d20277072652720277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "W-attached-equals",
    "argsHex": [
      "2d6f",
      "573b",
      "2d6c",
      "616c7068613a3a",
      "2d2d",
      "2d57616c7068613d78",
      "2d57616c706861",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d2d616c70686120277827202d2d616c706861202727202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "W-required-literal-terminator",
    "argsHex": [
      "2d6f",
      "573b",
      "2d6c",
      "616c7068613a",
      "2d2d",
      "2d57",
      "616c706861",
      "2d2d",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d2d616c70686120272d2d27202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "W-unknown-after-short",
    "argsHex": [
      "2d6f",
      "61573b",
      "2d6c",
      "616c706861",
      "2d2d",
      "2d61577a7a7a",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 1,
    "stdoutHex": "202d61202d2d20277461696c270a",
    "stderrHex": "6765746f70743a20756e7265636f676e697a6564206f7074696f6e20272d57207a7a7a270a"
  },
  {
    "name": "W-silent-missing",
    "argsHex": [
      "2d6f",
      "3a573b",
      "2d2d",
      "2d57"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 1,
    "stdoutHex": "202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "required-byte-one",
    "argsHex": [
      "2d6f",
      "013a",
      "2d2d",
      "2d0176616c7565",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202776616c756527202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "required-question",
    "argsHex": [
      "2d6f",
      "3f3a61",
      "2d2d",
      "2d3f76616c7565",
      "2d61",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 1,
    "stdoutHex": "202d61202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "plus-optional-declared",
    "argsHex": [
      "2d6f",
      "2b612b3a3a",
      "2d2d",
      "2d2b78",
      "2d61",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d2b202d61202d2d20277461696c270a",
    "stderrHex": ""
  },
  {
    "name": "minus-required-declared",
    "argsHex": [
      "2d6f",
      "2d612d3a",
      "2d2d",
      "707265",
      "2d612d",
      "76616c7565",
      "7461696c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202770726527202d61202d2d20277461696c27202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "long-schema-equals",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "666f6f3d6261722c666f6f3a",
      "2d2d",
      "2d2d666f6f3d626172"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d2d666f6f202762617227202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "long-schema-leading-dash",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "2d666f6f",
      "2d2d",
      "2d2d2d666f6f"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d2d2d666f6f202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "triple-schema-colon-tail",
    "argsHex": [
      "2d6f",
      "",
      "2d6c",
      "616c7068613a3a3a3a",
      "2d2d",
      "2d2d616c7068613a3a3d78"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d2d616c7068613a3a20277827202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "duplicate-short-first-noarg",
    "argsHex": [
      "2d6f",
      "61613a",
      "2d2d",
      "2d61",
      "76616c7565"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d61202d2d202776616c7565270a",
    "stderrHex": ""
  },
  {
    "name": "duplicate-short-first-required",
    "argsHex": [
      "2d6f",
      "613a61",
      "2d2d",
      "2d61",
      "2d61"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d6120272d6127202d2d0a",
    "stderrHex": ""
  },
  {
    "name": "abbreviated-wrapper-no-value",
    "argsHex": [
      "2d2d7175693d78"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "6765746f70743a206f7074696f6e20272d2d7175693d782720697320616d626967756f75733b20706f73736962696c69746965733a20272d2d71756965742720272d2d71756965742d6f7574707574270a54727920276765746f7074202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "wrapper-version-value",
    "argsHex": [
      "2d2d7665723d78"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "6765746f70743a206f7074696f6e20272d2d76657273696f6e2720646f65736e277420616c6c6f7720616e20617267756d656e740a54727920276765746f7074202d2d68656c702720666f72206d6f726520696e666f726d6174696f6e2e0a"
  },
  {
    "name": "wrapper-alternative-prefix",
    "argsHex": [
      "2d2d616c",
      "2d6f",
      "61",
      "2d6c",
      "616c706861",
      "2d2d",
      "2d616c"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC"
    },
    "status": 0,
    "stdoutHex": "202d2d616c706861202d2d0a",
    "stderrHex": ""
  }
] as const;
