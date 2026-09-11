export interface NativeCase { readonly name: string; readonly args: readonly string[]; readonly inputBase64: string; readonly status: number; readonly stdoutBase64: string; readonly stderrBase64: string; readonly signal?: string | null; readonly stdout?: string; readonly stderr?: string; readonly env?: Readonly<Record<string, string>>; readonly qualification: { readonly status: number; readonly stdoutBase64: string; readonly stderrBase64: string } | null }

export const nativeCases: readonly NativeCase[] = [
  {
    "name": "basic",
    "args": [
      "0",
      "1",
      "2",
      "12",
      "360",
      "97"
    ],
    "inputBase64": "",
    "status": 0,
    "signal": null,
    "stdoutBase64": "MDoKMToKMjogMgoxMjogMiAyIDMKMzYwOiAyIDIgMiAzIDMgNQo5NzogOTcK",
    "stderrBase64": "",
    "stdout": "0:\n1:\n2: 2\n12: 2 2 3\n360: 2 2 2 3 3 5\n97: 97\n",
    "stderr": "",
    "qualification": null
  },
  {
    "name": "canonical",
    "args": [
      "00012",
      "+12",
      "  +12",
      "   12",
      "+0"
    ],
    "inputBase64": "",
    "status": 0,
    "signal": null,
    "stdoutBase64": "MTI6IDIgMiAzCjEyOiAyIDIgMwoxMjogMiAyIDMKMTI6IDIgMiAzCjA6Cg==",
    "stderrBase64": "",
    "stdout": "12: 2 2 3\n12: 2 2 3\n12: 2 2 3\n12: 2 2 3\n0:\n",
    "stderr": "",
    "qualification": null
  },
  {
    "name": "invalid",
    "args": [
      "",
      " ",
      "+",
      "++12",
      "+ 12",
      "12 ",
      "\t12",
      "12\n",
      "0x10",
      "1e2",
      "12.0",
      "１２",
      "12 18",
      "12\r"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiAnJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCmZhY3RvcjogJyAnIGlzIG5vdCBhIHZhbGlkIHBvc2l0aXZlIGludGVnZXIKZmFjdG9yOiAnKycgaXMgbm90IGEgdmFsaWQgcG9zaXRpdmUgaW50ZWdlcgpmYWN0b3I6ICcrKzEyJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCmZhY3RvcjogJysgMTInIGlzIG5vdCBhIHZhbGlkIHBvc2l0aXZlIGludGVnZXIKZmFjdG9yOiAnMTIgJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCmZhY3RvcjogJ1x0MTInIGlzIG5vdCBhIHZhbGlkIHBvc2l0aXZlIGludGVnZXIKZmFjdG9yOiAnMTJcbicgaXMgbm90IGEgdmFsaWQgcG9zaXRpdmUgaW50ZWdlcgpmYWN0b3I6ICcweDEwJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCmZhY3RvcjogJzFlMicgaXMgbm90IGEgdmFsaWQgcG9zaXRpdmUgaW50ZWdlcgpmYWN0b3I6ICcxMi4wJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCmZhY3RvcjogJ1wzNTdcMjc0XDIyMVwzNTdcMjc0XDIyMicgaXMgbm90IGEgdmFsaWQgcG9zaXRpdmUgaW50ZWdlcgpmYWN0b3I6ICcxMiAxOCcgaXMgbm90IGEgdmFsaWQgcG9zaXRpdmUgaW50ZWdlcgpmYWN0b3I6ICcxMlxyJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCg==",
    "stdout": "",
    "stderr": "factor: '' is not a valid positive integer\nfactor: ' ' is not a valid positive integer\nfactor: '+' is not a valid positive integer\nfactor: '++12' is not a valid positive integer\nfactor: '+ 12' is not a valid positive integer\nfactor: '12 ' is not a valid positive integer\nfactor: '\\t12' is not a valid positive integer\nfactor: '12\\n' is not a valid positive integer\nfactor: '0x10' is not a valid positive integer\nfactor: '1e2' is not a valid positive integer\nfactor: '12.0' is not a valid positive integer\nfactor: '\\357\\274\\221\\357\\274\\222' is not a valid positive integer\nfactor: '12 18' is not a valid positive integer\nfactor: '12\\r' is not a valid positive integer\n",
    "qualification": null
  },
  {
    "name": "negative-option",
    "args": [
      "-12"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiBpbnZhbGlkIG9wdGlvbiAtLSAnMScKVHJ5ICdmYWN0b3IgLS1oZWxwJyBmb3IgbW9yZSBpbmZvcm1hdGlvbi4K",
    "stdout": "",
    "stderr": "factor: invalid option -- '1'\nTry 'factor --help' for more information.\n",
    "qualification": null
  },
  {
    "name": "negative-operands",
    "args": [
      "--",
      "-12",
      "-0",
      "12"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "MTI6IDIgMiAzCg==",
    "stderrBase64": "ZmFjdG9yOiAnLTEyJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCmZhY3RvcjogJy0wJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCg==",
    "stdout": "12: 2 2 3\n",
    "stderr": "factor: '-12' is not a valid positive integer\nfactor: '-0' is not a valid positive integer\n",
    "qualification": null
  },
  {
    "name": "late-option",
    "args": [
      "12",
      "-1",
      "18"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiBpbnZhbGlkIG9wdGlvbiAtLSAnMScKVHJ5ICdmYWN0b3IgLS1oZWxwJyBmb3IgbW9yZSBpbmZvcm1hdGlvbi4K",
    "stdout": "",
    "stderr": "factor: invalid option -- '1'\nTry 'factor --help' for more information.\n",
    "qualification": null
  },
  {
    "name": "dash",
    "args": [
      "-"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiAnLScgaXMgbm90IGEgdmFsaWQgcG9zaXRpdmUgaW50ZWdlcgo=",
    "stdout": "",
    "stderr": "factor: '-' is not a valid positive integer\n",
    "qualification": null
  },
  {
    "name": "unknown-option",
    "args": [
      "--exponents",
      "12"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiB1bnJlY29nbml6ZWQgb3B0aW9uICctLWV4cG9uZW50cycKVHJ5ICdmYWN0b3IgLS1oZWxwJyBmb3IgbW9yZSBpbmZvcm1hdGlvbi4K",
    "stdout": "",
    "stderr": "factor: unrecognized option '--exponents'\nTry 'factor --help' for more information.\n",
    "qualification": null
  },
  {
    "name": "mixed",
    "args": [
      "12",
      "bad",
      "18",
      "-bad"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiBpbnZhbGlkIG9wdGlvbiAtLSAnYicKVHJ5ICdmYWN0b3IgLS1oZWxwJyBmb3IgbW9yZSBpbmZvcm1hdGlvbi4K",
    "stdout": "",
    "stderr": "factor: invalid option -- 'b'\nTry 'factor --help' for more information.\n",
    "qualification": null
  },
  {
    "name": "mixed-after-end",
    "args": [
      "--",
      "12",
      "bad",
      "18",
      "-bad"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "MTI6IDIgMiAzCjE4OiAyIDMgMwo=",
    "stderrBase64": "ZmFjdG9yOiAnYmFkJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCmZhY3RvcjogJy1iYWQnIGlzIG5vdCBhIHZhbGlkIHBvc2l0aXZlIGludGVnZXIK",
    "stdout": "12: 2 2 3\n18: 2 3 3\n",
    "stderr": "factor: 'bad' is not a valid positive integer\nfactor: '-bad' is not a valid positive integer\n",
    "qualification": null
  },
  {
    "name": "stdin-basic",
    "args": [],
    "inputBase64": "CjAgMQkxMgorMTggMDAwMjUgIAo=",
    "status": 0,
    "signal": null,
    "stdoutBase64": "MDoKMToKMTI6IDIgMiAzCjE4OiAyIDMgMwoyNTogNSA1Cg==",
    "stderrBase64": "",
    "stdout": "0:\n1:\n12: 2 2 3\n18: 2 3 3\n25: 5 5\n",
    "stderr": "",
    "qualification": null
  },
  {
    "name": "stdin-CR",
    "args": [],
    "inputBase64": "MTINCjE4Cg==",
    "status": 1,
    "signal": null,
    "stdoutBase64": "MTg6IDIgMyAzCg==",
    "stderrBase64": "ZmFjdG9yOiAnMTJccicgaXMgbm90IGEgdmFsaWQgcG9zaXRpdmUgaW50ZWdlcgo=",
    "stdout": "18: 2 3 3\n",
    "stderr": "factor: '12\\r' is not a valid positive integer\n",
    "qualification": null
  },
  {
    "name": "stdin-controls",
    "args": [],
    "inputBase64": "MTILMTggMjAMMzAgNDIK",
    "status": 1,
    "signal": null,
    "stdoutBase64": "NDI6IDIgMyA3Cg==",
    "stderrBase64": "ZmFjdG9yOiAnMTJcdjE4JyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCmZhY3RvcjogJzIwXGYzMCcgaXMgbm90IGEgdmFsaWQgcG9zaXRpdmUgaW50ZWdlcgo=",
    "stdout": "42: 2 3 7\n",
    "stderr": "factor: '12\\v18' is not a valid positive integer\nfactor: '20\\f30' is not a valid positive integer\n",
    "qualification": null
  },
  {
    "name": "stdin-negative",
    "args": [],
    "inputBase64": "LTEyIDE4Cg==",
    "status": 1,
    "signal": null,
    "stdoutBase64": "MTg6IDIgMyAzCg==",
    "stderrBase64": "ZmFjdG9yOiAnLTEyJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCg==",
    "stdout": "18: 2 3 3\n",
    "stderr": "factor: '-12' is not a valid positive integer\n",
    "qualification": null
  },
  {
    "name": "stdin-nul",
    "args": [],
    "inputBase64": "MTIAanVuayAxOAo=",
    "status": 0,
    "signal": null,
    "stdoutBase64": "MTI6IDIgMiAzCjE4OiAyIDMgMwo=",
    "stderrBase64": "",
    "stdout": "12: 2 2 3\n18: 2 3 3\n",
    "stderr": "",
    "qualification": null
  },
  {
    "name": "stdin-empty",
    "args": [],
    "inputBase64": "IAkK",
    "status": 0,
    "signal": null,
    "stdoutBase64": "",
    "stderrBase64": "",
    "stdout": "",
    "stderr": "",
    "qualification": null
  },
  {
    "name": "args-ignore-stdin",
    "args": [
      "12"
    ],
    "inputBase64": "MTggYmFkCg==",
    "status": 0,
    "signal": null,
    "stdoutBase64": "MTI6IDIgMiAzCg==",
    "stderrBase64": "",
    "stdout": "12: 2 2 3\n",
    "stderr": "",
    "qualification": null
  },
  {
    "name": "stdin-end-options",
    "args": [
      "--"
    ],
    "inputBase64": "MTIK",
    "status": 0,
    "signal": null,
    "stdoutBase64": "MTI6IDIgMiAzCg==",
    "stderrBase64": "",
    "stdout": "12: 2 2 3\n",
    "stderr": "",
    "qualification": null
  },
  {
    "name": "safe-wide-powers",
    "args": [
      "18446744073709551616",
      "170141183460469231731687303715884105728",
      "340282366920938463463374607431768211456"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "MTg0NDY3NDQwNzM3MDk1NTE2MTY6IDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIK",
    "stderrBase64": "ZmFjdG9yOiAnMTcwMTQxMTgzNDYwNDY5MjMxNzMxNjg3MzAzNzE1ODg0MTA1NzI4JyBpcyB0b28gbGFyZ2UKZmFjdG9yOiAnMzQwMjgyMzY2OTIwOTM4NDYzNDYzMzc0NjA3NDMxNzY4MjExNDU2JyBpcyB0b28gbGFyZ2UK",
    "stdout": "18446744073709551616: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2\n",
    "stderr": "factor: '170141183460469231731687303715884105728' is too large\nfactor: '340282366920938463463374607431768211456' is too large\n",
    "qualification": {
      "status": 1,
      "stdoutBase64": "",
      "stderrBase64": "ZmFjdG9yOiAnMTg0NDY3NDQwNzM3MDk1NTE2MTYnIGV4Y2VlZHMgc3VwcG9ydGVkIG1heGltdW0gNDI5NDk2NzI5NQpmYWN0b3I6ICcxNzAxNDExODM0NjA0NjkyMzE3MzE2ODczMDM3MTU4ODQxMDU3MjgnIGV4Y2VlZHMgc3VwcG9ydGVkIG1heGltdW0gNDI5NDk2NzI5NQpmYWN0b3I6ICczNDAyODIzNjY5MjA5Mzg0NjM0NjMzNzQ2MDc0MzE3NjgyMTE0NTYnIGV4Y2VlZHMgc3VwcG9ydGVkIG1heGltdW0gNDI5NDk2NzI5NQo="
    }
  },
  {
    "name": "gmp-profile",
    "args": [
      "---debug",
      "340282366920938463463374607431768211456"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiAnMzQwMjgyMzY2OTIwOTM4NDYzNDYzMzc0NjA3NDMxNzY4MjExNDU2JyBpcyB0b28gbGFyZ2UK",
    "stdout": "",
    "stderr": "factor: '340282366920938463463374607431768211456' is too large\n",
    "qualification": {
      "status": 1,
      "stdoutBase64": "",
      "stderrBase64": "ZmFjdG9yOiAnMzQwMjgyMzY2OTIwOTM4NDYzNDYzMzc0NjA3NDMxNzY4MjExNDU2JyBleGNlZWRzIHN1cHBvcnRlZCBtYXhpbXVtIDQyOTQ5NjcyOTUK"
    }
  },
  {
    "name": "cheap-composites",
    "args": [
      "561",
      "1105",
      "1729",
      "1024",
      "9409",
      "10403"
    ],
    "inputBase64": "",
    "status": 0,
    "signal": null,
    "stdoutBase64": "NTYxOiAzIDExIDE3CjExMDU6IDUgMTMgMTcKMTcyOTogNyAxMyAxOQoxMDI0OiAyIDIgMiAyIDIgMiAyIDIgMiAyCjk0MDk6IDk3IDk3CjEwNDAzOiAxMDEgMTAzCg==",
    "stderrBase64": "",
    "stdout": "561: 3 11 17\n1105: 5 13 17\n1729: 7 13 19\n1024: 2 2 2 2 2 2 2 2 2 2\n9409: 97 97\n10403: 101 103\n",
    "stderr": "",
    "qualification": null
  },
  {
    "name": "highest-accepted-bit",
    "args": [
      "85070591730234615865843651857942052864"
    ],
    "inputBase64": "",
    "status": 0,
    "signal": null,
    "stdoutBase64": "ODUwNzA1OTE3MzAyMzQ2MTU4NjU4NDM2NTE4NTc5NDIwNTI4NjQ6IDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyCg==",
    "stderrBase64": "",
    "stdout": "85070591730234615865843651857942052864: 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2 2\n",
    "stderr": "",
    "qualification": {
      "status": 1,
      "stdoutBase64": "",
      "stderrBase64": "ZmFjdG9yOiAnODUwNzA1OTE3MzAyMzQ2MTU4NjU4NDM2NTE4NTc5NDIwNTI4NjQnIGV4Y2VlZHMgc3VwcG9ydGVkIG1heGltdW0gNDI5NDk2NzI5NQo="
    }
  },
  {
    "name": "overflow-invalid",
    "args": [
      "340282366920938463463374607431768211456x"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiAnMzQwMjgyMzY2OTIwOTM4NDYzNDYzMzc0NjA3NDMxNzY4MjExNDU2eCcgaXMgbm90IGEgdmFsaWQgcG9zaXRpdmUgaW50ZWdlcgo=",
    "stdout": "",
    "stderr": "factor: '340282366920938463463374607431768211456x' is not a valid positive integer\n",
    "qualification": null
  },
  {
    "name": "short-h",
    "args": [
      "-h",
      "12"
    ],
    "inputBase64": "",
    "status": 1,
    "signal": null,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiBpbnZhbGlkIG9wdGlvbiAtLSAnaCcKVHJ5ICdmYWN0b3IgLS1oZWxwJyBmb3IgbW9yZSBpbmZvcm1hdGlvbi4K",
    "stdout": "",
    "stderr": "factor: invalid option -- 'h'\nTry 'factor --help' for more information.\n",
    "qualification": null
  },
  {
    "name": "stdin-final-token",
    "args": [],
    "inputBase64": "MTIgMTg=",
    "status": 0,
    "signal": null,
    "stdoutBase64": "MTI6IDIgMiAzCjE4OiAyIDMgMwo=",
    "stderrBase64": "",
    "stdout": "12: 2 2 3\n18: 2 3 3\n",
    "stderr": "",
    "qualification": null
  }
];
