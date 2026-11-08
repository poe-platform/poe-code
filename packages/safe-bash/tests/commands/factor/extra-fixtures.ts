import type { NativeCase } from "./fixtures.js";

export const extraNativeCases: readonly NativeCase[] = [
  {
    "name": "uint32-max",
    "args": [
      "4294967295"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "",
    "status": 0,
    "stdoutBase64": "NDI5NDk2NzI5NTogMyA1IDE3IDI1NyA2NTUzNwo=",
    "stderrBase64": "",
    "qualification": null
  },
  {
    "name": "uint32-prime",
    "args": [
      "4294967291"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "",
    "status": 0,
    "stdoutBase64": "NDI5NDk2NzI5MTogNDI5NDk2NzI5MQo=",
    "stderrBase64": "",
    "qualification": null
  },
  {
    "name": "prime-and-powers",
    "args": [
      "2147483647",
      "2147483648",
      "65521",
      "3215031751"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "",
    "status": 0,
    "stdoutBase64": "MjE0NzQ4MzY0NzogMjE0NzQ4MzY0NwoyMTQ3NDgzNjQ4OiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyIDIgMiAyCjY1NTIxOiA2NTUyMQozMjE1MDMxNzUxOiAxNTEgNzUxIDI4MzUxCg==",
    "stderrBase64": "",
    "qualification": null
  },
  {
    "name": "debug-small",
    "args": [
      "---debug",
      "12"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "",
    "status": 0,
    "stdoutBase64": "MTI6IDIgMiAzCg==",
    "stderrBase64": "W3VzaW5nIHNpbmdsZS1wcmVjaXNpb24gYXJpdGhtZXRpY10g",
    "qualification": null
  },
  {
    "name": "debug-prefix",
    "args": [
      "---d",
      "12"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "",
    "status": 0,
    "stdoutBase64": "MTI6IDIgMiAzCg==",
    "stderrBase64": "W3VzaW5nIHNpbmdsZS1wcmVjaXNpb24gYXJpdGhtZXRpY10g",
    "qualification": null
  },
  {
    "name": "help-value",
    "args": [
      "--he=x"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiBvcHRpb24gJy0taGVscCcgZG9lc24ndCBhbGxvdyBhbiBhcmd1bWVudApUcnkgJ2ZhY3RvciAtLWhlbHAnIGZvciBtb3JlIGluZm9ybWF0aW9uLgo=",
    "qualification": null
  },
  {
    "name": "version-value",
    "args": [
      "--v=x"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiBvcHRpb24gJy0tdmVyc2lvbicgZG9lc24ndCBhbGxvdyBhbiBhcmd1bWVudApUcnkgJ2ZhY3RvciAtLWhlbHAnIGZvciBtb3JlIGluZm9ybWF0aW9uLgo=",
    "qualification": null
  },
  {
    "name": "debug-value",
    "args": [
      "---d=x"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "ZmFjdG9yOiBvcHRpb24gJy0tLWRlYnVnJyBkb2Vzbid0IGFsbG93IGFuIGFyZ3VtZW50ClRyeSAnZmFjdG9yIC0taGVscCcgZm9yIG1vcmUgaW5mb3JtYXRpb24uCg==",
    "qualification": null
  },
  {
    "name": "posix-empty",
    "args": [
      "12",
      "-1",
      "18"
    ],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin",
      "POSIXLY_CORRECT": ""
    },
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "MTI6IDIgMiAzCjE4OiAyIDMgMwo=",
    "stderrBase64": "ZmFjdG9yOiAnLTEnIGlzIG5vdCBhIHZhbGlkIHBvc2l0aXZlIGludGVnZXIK",
    "qualification": null
  },
  {
    "name": "nul-empty",
    "args": [],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "AGp1bmsgMTI=",
    "status": 1,
    "stdoutBase64": "MTI6IDIgMiAzCg==",
    "stderrBase64": "ZmFjdG9yOiAnJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCg==",
    "qualification": null
  },
  {
    "name": "nul-invalid",
    "args": [],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "YmFkAGlnbm9yZWQgMTg=",
    "status": 1,
    "stdoutBase64": "MTg6IDIgMyAzCg==",
    "stderrBase64": "ZmFjdG9yOiAnYmFkJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCg==",
    "qualification": null
  },
  {
    "name": "raw-quotes",
    "args": [],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "Y2FuJ3Rcb3BlbiD/IDEy",
    "status": 1,
    "stdoutBase64": "MTI6IDIgMiAzCg==",
    "stderrBase64": "ZmFjdG9yOiAnY2FuXCd0XFxvcGVuJyBpcyBub3QgYSB2YWxpZCBwb3NpdGl2ZSBpbnRlZ2VyCmZhY3RvcjogJ1wzNzcnIGlzIG5vdCBhIHZhbGlkIHBvc2l0aXZlIGludGVnZXIK",
    "qualification": null
  },
  {
    "name": "batch-511",
    "args": [],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "MCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAxMDA=",
    "status": 0,
    "stdoutBase64": "MDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMTAwOiAyIDIgNSA1Cg==",
    "stderrBase64": "",
    "qualification": null
  },
  {
    "name": "batch-512",
    "args": [],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "MCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAy",
    "status": 0,
    "stdoutBase64": "MDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMjogMgo=",
    "stderrBase64": "",
    "qualification": null
  },
  {
    "name": "batch-513",
    "args": [],
    "env": {
      "LC_ALL": "C",
      "TZ": "UTC",
      "PATH": "/usr/bin:/bin"
    },
    "inputBase64": "MCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAg",
    "status": 0,
    "stdoutBase64": "MDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoKMDoK",
    "stderrBase64": "",
    "qualification": null
  }
];
