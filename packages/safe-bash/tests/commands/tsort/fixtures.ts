export const files: Readonly<Record<string, string>> = {
  "pairs": "7a20610a6120620a",
  "cycle": "7420620a7420730a7320740a",
  "-r": "7820790a"
};

export const nativeCases = [
  {
    "name": "empty",
    "args": [],
    "inputBase64": "",
    "status": 0,
    "stdoutBase64": "",
    "stderrBase64": ""
  },
  {
    "name": "stdin-dash",
    "args": [
      "-"
    ],
    "inputBase64": "YiBjIGEgYgo=",
    "status": 0,
    "stdoutBase64": "YQpiCmMK",
    "stderrBase64": ""
  },
  {
    "name": "roots-input-reversed",
    "args": [],
    "inputBase64": "eiB6IGEgYSBtIG0K",
    "status": 0,
    "stdoutBase64": "YQptCnoK",
    "stderrBase64": ""
  },
  {
    "name": "fifo-not-priority",
    "args": [],
    "inputBase64": "YSBiIHogego=",
    "status": 0,
    "stdoutBase64": "YQp6CmIK",
    "stderrBase64": ""
  },
  {
    "name": "successors-forward-input",
    "args": [],
    "inputBase64": "YSBiIGEgYyBhIGQK",
    "status": 0,
    "stdoutBase64": "YQpkCmMKYgo=",
    "stderrBase64": ""
  },
  {
    "name": "successors-reverse-input",
    "args": [],
    "inputBase64": "YSBkIGEgYyBhIGIK",
    "status": 0,
    "stdoutBase64": "YQpiCmMKZAo=",
    "stderrBase64": ""
  },
  {
    "name": "duplicate-affects-queue",
    "args": [],
    "inputBase64": "YSBiIGEgYyBhIGIK",
    "status": 0,
    "stdoutBase64": "YQpjCmIK",
    "stderrBase64": ""
  },
  {
    "name": "duplicate-control",
    "args": [],
    "inputBase64": "YSBiIGEgYwo=",
    "status": 0,
    "stdoutBase64": "YQpjCmIK",
    "stderrBase64": ""
  },
  {
    "name": "self-is-node",
    "args": [],
    "inputBase64": "eiB6IGEgYSB6IHoK",
    "status": 0,
    "stdoutBase64": "YQp6Cg==",
    "stderrBase64": ""
  },
  {
    "name": "posix-1",
    "args": [],
    "inputBase64": "YSBiIGMgYyBkIGUKZyBnCmYgZyBlIGYKaCBoCg==",
    "status": 0,
    "stdoutBase64": "YQpjCmQKaApiCmUKZgpnCg==",
    "stderrBase64": ""
  },
  {
    "name": "posix-2",
    "args": [],
    "inputBase64": "YiBhCmQgYwp6IGggeCBoIHIgaAo=",
    "status": 0,
    "stdoutBase64": "YgpkCnIKeAp6CmEKYwpoCg==",
    "stderrBase64": ""
  },
  {
    "name": "tree-1",
    "args": [],
    "inputBase64": "YSBiIGIgYyBjIGQgZCBlIGUgZiBmIGcKYyB4IHggeSB5IHoK",
    "status": 0,
    "stdoutBase64": "YQpiCmMKeApkCnkKZQp6CmYKZwo=",
    "stderrBase64": ""
  },
  {
    "name": "tree-2",
    "args": [],
    "inputBase64": "YSBiIGIgYyBjIGQgZCBlIGUgZiBmIGcKYyB4IHggeSB5IHoKZiByIHIgcyBzIHQK",
    "status": 0,
    "stdoutBase64": "YQpiCmMKeApkCnkKZQp6CmYKcgpnCnMKdAo=",
    "stderrBase64": ""
  },
  {
    "name": "cycle-two",
    "args": [],
    "inputBase64": "YSBiIGIgYQo=",
    "status": 1,
    "stdoutBase64": "YQpiCg==",
    "stderrBase64": "dHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IGEKdHNvcnQ6IGIK"
  },
  {
    "name": "cycle-with-prefix-tail",
    "args": [],
    "inputBase64": "eCB5IGEgYiBiIGEgYiBjCg==",
    "status": 1,
    "stdoutBase64": "eAp5CmEKYgpjCg==",
    "stderrBase64": "dHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IGEKdHNvcnQ6IGIK"
  },
  {
    "name": "cycles-disjoint",
    "args": [],
    "inputBase64": "YSBiIGIgYSBjIGQgZCBjCg==",
    "status": 1,
    "stdoutBase64": "YQpiCmMKZAo=",
    "stderrBase64": "dHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IGEKdHNvcnQ6IGIKdHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IGMKdHNvcnQ6IGQK"
  },
  {
    "name": "cycles-overlap",
    "args": [],
    "inputBase64": "YSBiIGIgYSBhIGMgYyBhCg==",
    "status": 1,
    "stdoutBase64": "YQpjCmIK",
    "stderrBase64": "dHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IGEKdHNvcnQ6IGIKdHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IGEKdHNvcnQ6IGMK"
  },
  {
    "name": "duplicate-cycle",
    "args": [],
    "inputBase64": "YSBiIGEgYiBiIGEK",
    "status": 1,
    "stdoutBase64": "YQpiCg==",
    "stderrBase64": "dHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IGEKdHNvcnQ6IGIK"
  },
  {
    "name": "cycle-upstream-1",
    "args": [
      "cycle"
    ],
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "cwp0CmIK",
    "stderrBase64": "dHNvcnQ6IGN5Y2xlOiBpbnB1dCBjb250YWlucyBhIGxvb3A6CnRzb3J0OiBzCnRzb3J0OiB0Cg=="
  },
  {
    "name": "cycle-upstream-2",
    "args": [],
    "inputBase64": "dCB4CnQgcwpzIHQK",
    "status": 1,
    "stdoutBase64": "cwp0CngK",
    "stderrBase64": "dHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IHMKdHNvcnQ6IHQK"
  },
  {
    "name": "odd-after-pair",
    "args": [],
    "inputBase64": "YSBiIGMK",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "dHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGFuIG9kZCBudW1iZXIgb2YgdG9rZW5zCg=="
  },
  {
    "name": "odd-one",
    "args": [],
    "inputBase64": "YQ==",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "dHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGFuIG9kZCBudW1iZXIgb2YgdG9rZW5zCg=="
  },
  {
    "name": "delimiter-space-tab-lf",
    "args": [],
    "inputBase64": "IAlhCWIKYgljCg==",
    "status": 0,
    "stdoutBase64": "YQpiCmMK",
    "stderrBase64": ""
  },
  {
    "name": "cr-not-delimiter",
    "args": [],
    "inputBase64": "YQ1iIGMK",
    "status": 0,
    "stdoutBase64": "YQ1iCmMK",
    "stderrBase64": ""
  },
  {
    "name": "vt-ff-not-delimiters",
    "args": [],
    "inputBase64": "YQtiIGMMZAo=",
    "status": 0,
    "stdoutBase64": "YQtiCmMMZAo=",
    "stderrBase64": ""
  },
  {
    "name": "nul-c-string",
    "args": [],
    "inputBase64": "YQB4IGIgYQB5IGMK",
    "status": 0,
    "stdoutBase64": "YQpjCmIK",
    "stderrBase64": ""
  },
  {
    "name": "raw-byte-names",
    "args": [],
    "inputBase64": "/yD/IP4g/go=",
    "status": 0,
    "stdoutBase64": "/gr/Cg==",
    "stderrBase64": ""
  },
  {
    "name": "file",
    "args": [
      "pairs"
    ],
    "inputBase64": "aWdub3JlZA==",
    "status": 0,
    "stdoutBase64": "egphCmIK",
    "stderrBase64": ""
  },
  {
    "name": "missing-file",
    "args": [
      "absent"
    ],
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "dHNvcnQ6IGFic2VudDogTm8gc3VjaCBmaWxlIG9yIGRpcmVjdG9yeQo="
  },
  {
    "name": "directory-read",
    "args": [
      "."
    ],
    "inputBase64": "",
    "status": 0,
    "stdoutBase64": "",
    "stderrBase64": ""
  },
  {
    "name": "extra-operands",
    "args": [
      "pairs",
      "other"
    ],
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "dHNvcnQ6IGV4dHJhIG9wZXJhbmQgJ290aGVyJwpUcnkgJ3Rzb3J0IC0taGVscCcgZm9yIG1vcmUgaW5mb3JtYXRpb24uCg=="
  },
  {
    "name": "unknown-long",
    "args": [
      "--reverse"
    ],
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "dHNvcnQ6IHVucmVjb2duaXplZCBvcHRpb24gJy0tcmV2ZXJzZScKVHJ5ICd0c29ydCAtLWhlbHAnIGZvciBtb3JlIGluZm9ybWF0aW9uLgo="
  },
  {
    "name": "short-r",
    "args": [
      "-r"
    ],
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "dHNvcnQ6IGludmFsaWQgb3B0aW9uIC0tICdyJwpUcnkgJ3Rzb3J0IC0taGVscCcgZm9yIG1vcmUgaW5mb3JtYXRpb24uCg=="
  },
  {
    "name": "short-h",
    "args": [
      "-h"
    ],
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "dHNvcnQ6IGludmFsaWQgb3B0aW9uIC0tICdoJwpUcnkgJ3Rzb3J0IC0taGVscCcgZm9yIG1vcmUgaW5mb3JtYXRpb24uCg=="
  },
  {
    "name": "help",
    "args": [
      "--help"
    ],
    "inputBase64": "",
    "status": 0,
    "stdoutBase64": "VXNhZ2U6IHRzb3J0IFtPUFRJT05dIFtGSUxFXQpXcml0ZSB0b3RhbGx5IG9yZGVyZWQgbGlzdCBjb25zaXN0ZW50IHdpdGggdGhlIHBhcnRpYWwgb3JkZXJpbmcgaW4gRklMRS4KCldpdGggbm8gRklMRSwgb3Igd2hlbiBGSUxFIGlzIC0sIHJlYWQgc3RhbmRhcmQgaW5wdXQuCgogICAgICAtLWhlbHAgICAgIGRpc3BsYXkgdGhpcyBoZWxwIGFuZCBleGl0CiAgICAgIC0tdmVyc2lvbiAgb3V0cHV0IHZlcnNpb24gaW5mb3JtYXRpb24gYW5kIGV4aXQKCkdOVSBjb3JldXRpbHMgb25saW5lIGhlbHA6IDxodHRwczovL3d3dy5nbnUub3JnL3NvZnR3YXJlL2NvcmV1dGlscy8+ClJlcG9ydCB0c29ydCB0cmFuc2xhdGlvbiBidWdzIHRvIDxodHRwczovL3RyYW5zbGF0aW9ucHJvamVjdC5vcmcvdGVhbS8+CkZ1bGwgZG9jdW1lbnRhdGlvbiBhdDogPGh0dHBzOi8vd3d3LmdudS5vcmcvc29mdHdhcmUvY29yZXV0aWxzL3Rzb3J0PgpvciBhdmFpbGFibGUgbG9jYWxseSB2aWE6IGluZm8gJyhjb3JldXRpbHMpIHRzb3J0IGludm9jYXRpb24nCg==",
    "stderrBase64": ""
  },
  {
    "name": "help-prefix",
    "args": [
      "--he"
    ],
    "inputBase64": "",
    "status": 0,
    "stdoutBase64": "VXNhZ2U6IHRzb3J0IFtPUFRJT05dIFtGSUxFXQpXcml0ZSB0b3RhbGx5IG9yZGVyZWQgbGlzdCBjb25zaXN0ZW50IHdpdGggdGhlIHBhcnRpYWwgb3JkZXJpbmcgaW4gRklMRS4KCldpdGggbm8gRklMRSwgb3Igd2hlbiBGSUxFIGlzIC0sIHJlYWQgc3RhbmRhcmQgaW5wdXQuCgogICAgICAtLWhlbHAgICAgIGRpc3BsYXkgdGhpcyBoZWxwIGFuZCBleGl0CiAgICAgIC0tdmVyc2lvbiAgb3V0cHV0IHZlcnNpb24gaW5mb3JtYXRpb24gYW5kIGV4aXQKCkdOVSBjb3JldXRpbHMgb25saW5lIGhlbHA6IDxodHRwczovL3d3dy5nbnUub3JnL3NvZnR3YXJlL2NvcmV1dGlscy8+ClJlcG9ydCB0c29ydCB0cmFuc2xhdGlvbiBidWdzIHRvIDxodHRwczovL3RyYW5zbGF0aW9ucHJvamVjdC5vcmcvdGVhbS8+CkZ1bGwgZG9jdW1lbnRhdGlvbiBhdDogPGh0dHBzOi8vd3d3LmdudS5vcmcvc29mdHdhcmUvY29yZXV0aWxzL3Rzb3J0PgpvciBhdmFpbGFibGUgbG9jYWxseSB2aWE6IGluZm8gJyhjb3JldXRpbHMpIHRzb3J0IGludm9jYXRpb24nCg==",
    "stderrBase64": ""
  },
  {
    "name": "version",
    "args": [
      "--version"
    ],
    "inputBase64": "",
    "status": 0,
    "stdoutBase64": "dHNvcnQgKGNvcmV1dGlscykgOC4zMApDb3B5cmlnaHQgKEMpIDIwMTggRnJlZSBTb2Z0d2FyZSBGb3VuZGF0aW9uLCBJbmMuCkxpY2Vuc2UgR1BMdjMrOiBHTlUgR1BMIHZlcnNpb24gMyBvciBsYXRlciA8aHR0cHM6Ly9nbnUub3JnL2xpY2Vuc2VzL2dwbC5odG1sPi4KVGhpcyBpcyBmcmVlIHNvZnR3YXJlOiB5b3UgYXJlIGZyZWUgdG8gY2hhbmdlIGFuZCByZWRpc3RyaWJ1dGUgaXQuClRoZXJlIGlzIE5PIFdBUlJBTlRZLCB0byB0aGUgZXh0ZW50IHBlcm1pdHRlZCBieSBsYXcuCgpXcml0dGVuIGJ5IE1hcmsgS2V0dGVuaXMuCg==",
    "stderrBase64": ""
  },
  {
    "name": "help-with-file",
    "args": [
      "--help",
      "pairs"
    ],
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "dHNvcnQ6IHVucmVjb2duaXplZCBvcHRpb24gJy0taGVscCcKVHJ5ICd0c29ydCAtLWhlbHAnIGZvciBtb3JlIGluZm9ybWF0aW9uLgo="
  },
  {
    "name": "help-after-file",
    "args": [
      "pairs",
      "--help"
    ],
    "inputBase64": "",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "dHNvcnQ6IHVucmVjb2duaXplZCBvcHRpb24gJy0taGVscCcKVHJ5ICd0c29ydCAtLWhlbHAnIGZvciBtb3JlIGluZm9ybWF0aW9uLgo="
  },
  {
    "name": "end-options",
    "args": [
      "--",
      "-r"
    ],
    "inputBase64": "",
    "status": 0,
    "stdoutBase64": "eAp5Cg==",
    "stderrBase64": ""
  },
  {
    "name": "double-stdin",
    "args": [
      "-",
      "-"
    ],
    "inputBase64": "YSBi",
    "status": 1,
    "stdoutBase64": "",
    "stderrBase64": "dHNvcnQ6IGV4dHJhIG9wZXJhbmQgJy0nClRyeSAndHNvcnQgLS1oZWxwJyBmb3IgbW9yZSBpbmZvcm1hdGlvbi4K"
  },
  {
    "name": "duplicate-back-edge",
    "args": [],
    "inputBase64": "YSBiIGIgYSBiIGEK",
    "status": 1,
    "stdoutBase64": "YQpiCg==",
    "stderrBase64": "dHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IGEKdHNvcnQ6IGIKdHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IGEKdHNvcnQ6IGIK"
  },
  {
    "name": "nul-empty-node",
    "args": [],
    "inputBase64": "AHggYgo=",
    "status": 0,
    "stdoutBase64": "CmIK",
    "stderrBase64": ""
  },
  {
    "name": "cycle-input-reversed",
    "args": [],
    "inputBase64": "YyBhIGEgYyBiIGEgYSBiCg==",
    "status": 1,
    "stdoutBase64": "YQpiCmMK",
    "stderrBase64": "dHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IGEKdHNvcnQ6IGIKdHNvcnQ6IC06IGlucHV0IGNvbnRhaW5zIGEgbG9vcDoKdHNvcnQ6IGEKdHNvcnQ6IGMK"
  }
] as const;

