export const files = {
  "a": "310a320a330a340a350a360a370a",
  "b": "410a420a430a",
  "controls": "410a0c420a43",
  "empty": "",
  "wide": "6162636465666768696a6b0a4142434445464748494a4b0a31323334353637383930310a"
};

export const nativeCases = [
  {
    "name": "default",
    "args": [
      "a"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520310a0a0a310a320a330a340a350a360a370a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a",
    "stderr": ""
  },
  {
    "name": "header",
    "args": [
      "-h",
      "TITLE",
      "-l",
      "12",
      "a"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "0a0a323030302d30312d30312030303a3030202020202020202020202020202020202020202020205449544c4520202020202020202020202020202020202020202020205061676520310a0a0a310a320a0a0a0a0a0a0a0a323030302d30312d30312030303a3030202020202020202020202020202020202020202020205449544c4520202020202020202020202020202020202020202020205061676520320a0a0a330a340a0a0a0a0a0a0a0a323030302d30312d30312030303a3030202020202020202020202020202020202020202020205449544c4520202020202020202020202020202020202020202020205061676520330a0a0a350a360a0a0a0a0a0a0a0a323030302d30312d30312030303a3030202020202020202020202020202020202020202020205449544c4520202020202020202020202020202020202020202020205061676520340a0a0a370a0a0a0a0a0a0a",
    "stderr": ""
  },
  {
    "name": "columns",
    "args": [
      "-t",
      "-3",
      "-l",
      "4",
      "-w",
      "20",
      "a"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "3120202020202034202020202020360a3220202020202035202020202020370a330a",
    "stderr": ""
  },
  {
    "name": "number",
    "args": [
      "-t",
      "-n",
      "a"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "202020203109310a202020203209320a202020203309330a202020203409340a202020203509350a202020203609360a202020203709370a",
    "stderr": ""
  },
  {
    "name": "merge",
    "args": [
      "-t",
      "-m",
      "-w",
      "20",
      "a",
      "b"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "31092020410a32092020420a33092020430a340920200a350920200a360920200a370920200a",
    "stderr": ""
  },
  {
    "name": "merge-number",
    "args": [
      "-t",
      "-m",
      "-n",
      "-s:",
      "a",
      "b"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "202020203109313a410a202020203209323a420a202020203309333a430a202020203409343a0a202020203509353a0a202020203609363a0a202020203709373a0a",
    "stderr": ""
  },
  {
    "name": "separator",
    "args": [
      "-t",
      "-2",
      "-s:",
      "wide"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "6162636465666768696a6b3a31323334353637383930310a4142434445464748494a4b0a",
    "stderr": ""
  },
  {
    "name": "separator-width",
    "args": [
      "-t",
      "-2",
      "-s:",
      "-w",
      "9",
      "wide"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "616263643a313233340a414243440a",
    "stderr": ""
  },
  {
    "name": "single-width",
    "args": [
      "-t",
      "-w",
      "3",
      "wide"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "6162636465666768696a6b0a4142434445464748494a4b0a31323334353637383930310a",
    "stderr": ""
  },
  {
    "name": "separate-separator",
    "args": [
      "-t",
      "-2",
      "-s",
      ":",
      "a"
    ],
    "inputHex": null,
    "status": 1,
    "stdoutHex": "3109350a3209360a3309370a340a",
    "stderr": "pr: ':': No such file or directory\n"
  },
  {
    "name": "merge-columns-error",
    "args": [
      "-t",
      "-m",
      "-2",
      "a",
      "b"
    ],
    "inputHex": null,
    "status": 1,
    "stdoutHex": "",
    "stderr": "pr: cannot specify number of columns when printing in parallel\n"
  },
  {
    "name": "formfeed",
    "args": [
      "-t",
      "controls"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "410a0c420a430a",
    "stderr": ""
  },
  {
    "name": "empty",
    "args": [
      "empty"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "",
    "stderr": ""
  },
  {
    "name": "too-narrow",
    "args": [
      "-t",
      "-3",
      "-w",
      "2",
      "a"
    ],
    "inputHex": null,
    "status": 1,
    "stdoutHex": "",
    "stderr": "pr: page width too narrow\n"
  },
  {
    "name": "unterminated",
    "args": [
      "-t"
    ],
    "inputHex": "41",
    "status": 0,
    "stdoutHex": "410a",
    "stderr": ""
  },
  {
    "name": "bare-ff",
    "args": [
      "-t"
    ],
    "inputHex": "0c",
    "status": 0,
    "stdoutHex": "0c",
    "stderr": ""
  },
  {
    "name": "repeated-ff",
    "args": [
      "-t"
    ],
    "inputHex": "0c0c410a",
    "status": 0,
    "stdoutHex": "0c0c410a",
    "stderr": ""
  },
  {
    "name": "ff-followed-lf",
    "args": [
      "-t"
    ],
    "inputHex": "410c0a420a",
    "status": 0,
    "stdoutHex": "410a0c420a",
    "stderr": ""
  },
  {
    "name": "full-page-ff",
    "args": [
      "-t",
      "-l2"
    ],
    "inputHex": "410a420a0c0a430a",
    "status": 0,
    "stdoutHex": "410a420a430a",
    "stderr": ""
  },
  {
    "name": "balanced-ff",
    "args": [
      "-t",
      "-3",
      "-l2",
      "-w11"
    ],
    "inputHex": "310a320a330a340c350a360a",
    "status": 0,
    "stdoutHex": "312020203309340a320a0c35202020360a",
    "stderr": ""
  },
  {
    "name": "raw-single",
    "args": [
      "-t"
    ],
    "inputHex": "00ffc3a90d084109420a",
    "status": 0,
    "stdoutHex": "00ffc3a90d4109420a",
    "stderr": ""
  },
  {
    "name": "leading-backspace",
    "args": [
      "-t"
    ],
    "inputHex": "0808410808420a",
    "status": 0,
    "stdoutHex": "4108420a",
    "stderr": ""
  },
  {
    "name": "raw-narrow",
    "args": [
      "-t",
      "-2",
      "-w5"
    ],
    "inputHex": "41ffc3a942430a440d45460a",
    "status": 0,
    "stdoutHex": "41ffc3a94220440d450a",
    "stderr": ""
  },
  {
    "name": "tabs-narrow",
    "args": [
      "-t",
      "-2",
      "-w9"
    ],
    "inputHex": "09410a420a",
    "status": 0,
    "stdoutHex": "2020202020420a",
    "stderr": ""
  },
  {
    "name": "tabs-single",
    "args": [
      "-t"
    ],
    "inputHex": "61096220200a",
    "status": 0,
    "stdoutHex": "61096220200a",
    "stderr": ""
  },
  {
    "name": "trailing-space-columns",
    "args": [
      "-t",
      "-2",
      "-w9"
    ],
    "inputHex": "6120200a6220200a",
    "status": 0,
    "stdoutHex": "6120202020620a",
    "stderr": ""
  },
  {
    "name": "number-width-wrap",
    "args": [
      "-t",
      "-n:1"
    ],
    "inputHex": "310a320a330a340a350a360a370a380a390a31300a31310a",
    "status": 0,
    "stdoutHex": "313a310a323a320a333a330a343a340a353a350a363a360a373a370a383a380a393a390a303a31300a313a31310a",
    "stderr": ""
  },
  {
    "name": "number-tab-columns",
    "args": [
      "-t",
      "-2",
      "-n",
      "-w25"
    ],
    "inputHex": "610a620a630a",
    "status": 0,
    "stdoutHex": "2020202031096120202020092033202020630a202020203209620a",
    "stderr": ""
  },
  {
    "name": "number-narrow",
    "args": [
      "-t",
      "-2",
      "-n",
      "-w9"
    ],
    "inputHex": "610a620a",
    "status": 0,
    "stdoutHex": "2020202031096132202020620a",
    "stderr": ""
  },
  {
    "name": "separator-bare-width",
    "args": [
      "-t",
      "-2",
      "-s",
      "-w9"
    ],
    "inputHex": "6162636465660a6768696a6b6c0a",
    "status": 0,
    "stdoutHex": "616263646768696a0a",
    "stderr": ""
  },
  {
    "name": "separator-multibyte",
    "args": [
      "-t",
      "-2",
      "-s::"
    ],
    "inputHex": "610a620a",
    "status": 0,
    "stdoutHex": "613a3a620a",
    "stderr": ""
  },
  {
    "name": "separator-tab-width",
    "args": [
      "-t",
      "-2",
      "-s\t",
      "-w9"
    ],
    "inputHex": "610a620a",
    "status": 0,
    "stdoutHex": "6120202020620a",
    "stderr": ""
  },
  {
    "name": "short-page",
    "args": [
      "-l10"
    ],
    "inputHex": "610a",
    "status": 0,
    "stdoutHex": "610a",
    "stderr": ""
  },
  {
    "name": "eleven-page",
    "args": [
      "-l11",
      "a"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520310a0a0a310a0a0a0a0a0a0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520320a0a0a320a0a0a0a0a0a0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520330a0a0a330a0a0a0a0a0a0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520340a0a0a340a0a0a0a0a0a0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520350a0a0a350a0a0a0a0a0a0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520360a0a0a360a0a0a0a0a0a0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202061202020202020202020202020202020202020202020202020205061676520370a0a0a370a0a0a0a0a0a",
    "stderr": ""
  },
  {
    "name": "empty-header",
    "args": [
      "-h",
      "",
      "-l11",
      "b"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020205061676520310a0a0a410a0a0a0a0a0a0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020205061676520320a0a0a420a0a0a0a0a0a0a0a323030302d30312d30312030303a303020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020205061676520330a0a0a430a0a0a0a0a0a",
    "stderr": ""
  },
  {
    "name": "header-width",
    "args": [
      "-w3",
      "-l11",
      "-h",
      "LONG",
      "b"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "0a0a323030302d30312d30312030303a3030204c4f4e47205061676520310a0a0a410a0a0a0a0a0a0a0a323030302d30312d30312030303a3030204c4f4e47205061676520320a0a0a420a0a0a0a0a0a0a0a323030302d30312d30312030303a3030204c4f4e47205061676520330a0a0a430a0a0a0a0a0a",
    "stderr": ""
  },
  {
    "name": "merge-empty-first",
    "args": [
      "-t",
      "-m",
      "-n",
      "-s:",
      "empty",
      "b"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "20202020313a410a20202020323a420a20202020333a430a",
    "stderr": ""
  },
  {
    "name": "merge-empty-last",
    "args": [
      "-t",
      "-m",
      "-n",
      "-s:",
      "b",
      "empty"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "202020203109413a0a202020203209423a0a202020203309433a0a",
    "stderr": ""
  },
  {
    "name": "merge-missing",
    "args": [
      "-t",
      "-m",
      "-w20",
      "missing",
      "b"
    ],
    "inputHex": null,
    "status": 1,
    "stdoutHex": "410a420a430a",
    "stderr": "pr: missing: No such file or directory\n"
  },
  {
    "name": "merge-repeated-stdin",
    "args": [
      "-t",
      "-m",
      "-s:",
      "-",
      "-"
    ],
    "inputHex": "610a620a630a",
    "status": 0,
    "stdoutHex": "613a620a633a0a",
    "stderr": ""
  },
  {
    "name": "sequential-repeated-stdin",
    "args": [
      "-t",
      "-",
      "-"
    ],
    "inputHex": "610a620a",
    "status": 0,
    "stdoutHex": "610a620a",
    "stderr": ""
  },
  {
    "name": "merge-explicit-one",
    "args": [
      "-t",
      "-m",
      "-1",
      "a"
    ],
    "inputHex": null,
    "status": 1,
    "stdoutHex": "",
    "stderr": "pr: cannot specify number of columns when printing in parallel\n"
  },
  {
    "name": "columns-zero",
    "args": [
      "-t",
      "-0"
    ],
    "inputHex": "610a",
    "status": 1,
    "stdoutHex": "",
    "stderr": "pr: invalid number of columns: '0': Numerical result out of range\n"
  },
  {
    "name": "length-zero",
    "args": [
      "-t",
      "-l0"
    ],
    "inputHex": "610a",
    "status": 1,
    "stdoutHex": "",
    "stderr": "pr: '-l PAGE_LENGTH' invalid number of lines: '0': Numerical result out of range\n"
  },
  {
    "name": "width-zero",
    "args": [
      "-t",
      "-w0"
    ],
    "inputHex": "610a",
    "status": 1,
    "stdoutHex": "",
    "stderr": "pr: '-w PAGE_WIDTH' invalid number of characters: '0': Numerical result out of range\n"
  },
  {
    "name": "number-zero",
    "args": [
      "-t",
      "-n0"
    ],
    "inputHex": "610a",
    "status": 1,
    "stdoutHex": "",
    "stderr": "pr: '-n' extra characters or invalid number in the argument: '0'\nTry 'pr --help' for more information.\n"
  },
  {
    "name": "merged-options",
    "args": [
      "-t2",
      "-l2",
      "-w9"
    ],
    "inputHex": "610a620a630a",
    "status": 0,
    "stdoutHex": "6120202020630a620a",
    "stderr": ""
  },
  {
    "name": "options-after-file",
    "args": [
      "a",
      "-t"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "310a320a330a340a350a360a370a",
    "stderr": ""
  },
  {
    "name": "long-equivalents",
    "args": [
      "--omit-header",
      "--columns=2",
      "--separator=:",
      "--number-lines=:2",
      "b"
    ],
    "inputHex": null,
    "status": 0,
    "stdoutHex": "20313a413a20333a430a20323a420a",
    "stderr": ""
  },
  {
    "name": "merge-no-files",
    "args": [
      "-t",
      "-m"
    ],
    "inputHex": "610a620a",
    "status": 0,
    "stdoutHex": "610a620a",
    "stderr": ""
  }
];

