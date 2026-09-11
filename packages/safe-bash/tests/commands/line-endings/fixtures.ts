export const nativeCases = [
  {
    "command": "dos2unix",
    "name": "empty",
    "args": [],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "mixed",
    "args": [],
    "inputHex": "410d0a420a430d440d0d0a450d",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a420a430d440d0a450d",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "unterminated",
    "args": [],
    "inputHex": "41",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "41",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "trailing-cr",
    "args": [],
    "inputHex": "410d",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "double-crlf",
    "args": [],
    "inputHex": "0d0d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "0d0a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "newline-extra",
    "args": [
      "-l"
    ],
    "inputHex": "410d0a420a430d440d0d0a450d",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a0a420a430d440d0a0a450d",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "raw-high",
    "args": [],
    "inputHex": "4180ffc0af0d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "4180ffc0af0a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "all-bytes-force",
    "args": [
      "-f"
    ],
    "inputHex": "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "binary-stdin",
    "args": [],
    "inputHex": "410d0a4200430d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "410a42",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520320a646f7332756e69783a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "dos2unix",
    "name": "binary-stdin-quiet",
    "args": [
      "-q"
    ],
    "inputHex": "410d0a4200430d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a42",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "binary-after-cr",
    "args": [],
    "inputHex": "410d00420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "410d",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520310a646f7332756e69783a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "dos2unix",
    "name": "binary-force",
    "args": [
      "-f"
    ],
    "inputHex": "410d0a4200430d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a4200430a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "force-then-safe",
    "args": [
      "-f",
      "-s"
    ],
    "inputHex": "410d0a4200430d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "410a42",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520320a646f7332756e69783a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "dos2unix",
    "name": "safe-then-force",
    "args": [
      "-s",
      "-f"
    ],
    "inputHex": "410d0a4200430d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a4200430a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "control-0",
    "args": [],
    "inputHex": "4100420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520310a646f7332756e69783a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "dos2unix",
    "name": "control-1",
    "args": [],
    "inputHex": "4101420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078303120666f756e64206174206c696e6520310a646f7332756e69783a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "dos2unix",
    "name": "control-8",
    "args": [],
    "inputHex": "4108420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078303820666f756e64206174206c696e6520310a646f7332756e69783a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "dos2unix",
    "name": "control-9",
    "args": [],
    "inputHex": "4109420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "4109420a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "control-10",
    "args": [],
    "inputHex": "410a420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a420a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "control-11",
    "args": [],
    "inputHex": "410b420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078304220666f756e64206174206c696e6520310a646f7332756e69783a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "dos2unix",
    "name": "control-12",
    "args": [],
    "inputHex": "410c420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410c420a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "control-13",
    "args": [],
    "inputHex": "410d420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d420a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "control-26",
    "args": [],
    "inputHex": "411a420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078314120666f756e64206174206c696e6520310a646f7332756e69783a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "dos2unix",
    "name": "control-31",
    "args": [],
    "inputHex": "411f420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078314620666f756e64206174206c696e6520310a646f7332756e69783a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "dos2unix",
    "name": "control-127",
    "args": [],
    "inputHex": "417f420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "417f420a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf8-bom-default",
    "args": [],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a420a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf8-bom-keep",
    "args": [
      "-b"
    ],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410a420a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf8-bom-add",
    "args": [
      "-m"
    ],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410a420a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf8-bom-remove",
    "args": [
      "-r"
    ],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a420a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf8-bom-add-remove",
    "args": [
      "-m",
      "-r"
    ],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a420a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf8-bom-remove-add",
    "args": [
      "-r",
      "-m"
    ],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410a420a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "add-bom-empty",
    "args": [
      "-m"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "keep-bom-absent",
    "args": [
      "-b"
    ],
    "inputHex": "410a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "embedded-bom",
    "args": [],
    "inputHex": "41efbbbf0d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "41efbbbf0a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "gb18030-bom",
    "args": [],
    "inputHex": "84319533410d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "short-bom-ff",
    "args": [],
    "inputHex": "ff",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a2063616e206e6f7420726561642066726f6d20696e7075742066696c653a20537563636573730a"
  },
  {
    "command": "dos2unix",
    "name": "short-bom-efbb",
    "args": [],
    "inputHex": "efbb",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a2063616e206e6f7420726561642066726f6d20696e7075742066696c653a20537563636573730a"
  },
  {
    "command": "dos2unix",
    "name": "short-bom-ef",
    "args": [],
    "inputHex": "ef",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a2063616e206e6f7420726561642066726f6d20696e7075742066696c653a20537563636573730a"
  },
  {
    "command": "dos2unix",
    "name": "short-bom-gb-prefix",
    "args": [],
    "inputHex": "843195",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a2063616e206e6f7420726561642066726f6d20696e7075742066696c653a20537563636573730a"
  },
  {
    "command": "dos2unix",
    "name": "utf16-le",
    "args": [],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410ac3a90a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-le-C",
    "args": [],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a",
    "stderrHex": "646f7332756e69783a20496e76616c6964206f7220696e636f6d706c657465206d756c746962797465206f722077696465206368617261637465720a646f7332756e69783a20536b697070696e67205554462d31362066696c6520737464696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520322e0a"
  },
  {
    "command": "dos2unix",
    "name": "utf16-le-keep",
    "args": [
      "-u"
    ],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "41000a00e9000a00",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-le-keep-remove",
    "args": [
      "-u",
      "-r"
    ],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "41000a00e9000a00",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-le-keep-add",
    "args": [
      "-u",
      "-m"
    ],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "fffe41000a00e9000a00",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-be",
    "args": [],
    "inputHex": "feff0041000d000a00e9000a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410ac3a90a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-be-C",
    "args": [],
    "inputHex": "feff0041000d000a00e9000a",
    "locale": "C",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a",
    "stderrHex": "646f7332756e69783a20496e76616c6964206f7220696e636f6d706c657465206d756c746962797465206f722077696465206368617261637465720a646f7332756e69783a20536b697070696e67205554462d31362066696c6520737464696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520322e0a"
  },
  {
    "command": "dos2unix",
    "name": "utf16-be-keep",
    "args": [
      "-u"
    ],
    "inputHex": "feff0041000d000a00e9000a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "0041000a00e9000a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-be-keep-remove",
    "args": [
      "-u",
      "-r"
    ],
    "inputHex": "feff0041000d000a00e9000a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "0041000a00e9000a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-be-keep-add",
    "args": [
      "-u",
      "-m"
    ],
    "inputHex": "feff0041000d000a00e9000a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "feff0041000a00e9000a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-assume-le",
    "args": [
      "-ul"
    ],
    "inputHex": "41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410ac3a90a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-assume-be",
    "args": [
      "-ub"
    ],
    "inputHex": "0041000d000a00e9000a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410ac3a90a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-bom-overrides-assumption",
    "args": [
      "-ub"
    ],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410ac3a90a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-surrogate",
    "args": [],
    "inputHex": "fffe3dd800de0d000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "f09f98800a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-odd",
    "args": [],
    "inputHex": "fffe41000d000a0042",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-high-at-eof",
    "args": [],
    "inputHex": "fffe410000d8",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "41",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf16-low-alone",
    "args": [],
    "inputHex": "fffe410000dc0a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "41",
    "stderrHex": "646f7332756e69783a206572726f723a20496e76616c696420737572726f6761746520706169722e204d697373696e67206869676820737572726f676174652e0a646f7332756e69783a20536b697070696e67205554462d31362066696c6520737464696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520312e0a"
  },
  {
    "command": "dos2unix",
    "name": "utf16-high-then-ascii",
    "args": [],
    "inputHex": "fffe410000d842000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "41",
    "stderrHex": "646f7332756e69783a206572726f723a20496e76616c696420737572726f6761746520706169722e204d697373696e67206c6f7720737572726f676174652e0a646f7332756e69783a20536b697070696e67205554462d31362066696c6520737464696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520312e0a"
  },
  {
    "command": "dos2unix",
    "name": "utf16-keep-invalid",
    "args": [
      "-u"
    ],
    "inputHex": "fffe410000dc0a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410000dc0a00",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "utf32-le",
    "args": [],
    "inputHex": "fffe0000410000000a000000",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c2030783030303020666f756e64206174206c696e6520310a646f7332756e69783a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "dos2unix",
    "name": "7bit",
    "args": [
      "-7"
    ],
    "inputHex": "4180ff0d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "4120200a",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "missing-mode",
    "args": [
      "-c"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a206f7074696f6e20272d632720726571756972657320616e20617267756d656e740a"
  },
  {
    "command": "dos2unix",
    "name": "invalid-mode",
    "args": [
      "-c",
      "bad"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20696e76616c69642062616420636f6e76657273696f6e206d6f6465207370656369666965640a"
  },
  {
    "command": "dos2unix",
    "name": "new-no-operands",
    "args": [
      "-n"
    ],
    "inputHex": "410d0a420a430d440d0d0a450d",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410a420a430d440d0a450d",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "new-unpaired",
    "args": [
      "-n",
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "692067633",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "692067633",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20746172676574206f662066696c6520696e206e6f742073706563696669656420696e206e65772d66696c65206d6f64650a"
  },
  {
    "command": "dos2unix",
    "name": "old-default",
    "args": [
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "56006315",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410a420a430d440d0a450d",
        "mode": 438,
        "inode": "56006316",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788698.275
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c6520696e20746f20556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "dos2unix",
    "name": "old-explicit",
    "args": [
      "-o",
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "280326070",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410a420a430d440d0a450d",
        "mode": 438,
        "inode": "280326071",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788698.275
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c6520696e20746f20556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "dos2unix",
    "name": "old-keepdate",
    "args": [
      "-k",
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "280326072",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410a420a430d440d0a450d",
        "mode": 438,
        "inode": "280326073",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c6520696e20746f20556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "dos2unix",
    "name": "old-umask77",
    "args": [
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "416047059",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410a420a430d440d0a450d",
        "mode": 438,
        "inode": "416047060",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788706.275
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c6520696e20746f20556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "dos2unix",
    "name": "new",
    "args": [
      "-n",
      "in",
      "out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "553707001",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "553707001",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "410a420a430d440d0a450d",
        "mode": 420,
        "inode": "553707002",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788706.275
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c6520696e20746f2066696c65206f757420696e20556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "dos2unix",
    "name": "new-replace",
    "args": [
      "-n",
      "in",
      "out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "56006317",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "4f524947494e414c",
        "mode": 384,
        "inode": "56006318",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "56006317",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "410a420a430d440d0a450d",
        "mode": 420,
        "inode": "56006319",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788710.275
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c6520696e20746f2066696c65206f757420696e20556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "dos2unix",
    "name": "new-same-path",
    "args": [
      "-n",
      "in",
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "280326074",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410a420a430d440d0a450d",
        "mode": 420,
        "inode": "280326075",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788710.275
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c6520696e20746f2066696c6520696e20696e20556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "dos2unix",
    "name": "binary-old",
    "args": [
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "280326076",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "280326076",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520320a646f7332756e69783a20536b697070696e672062696e6172792066696c6520696e0a"
  },
  {
    "command": "dos2unix",
    "name": "binary-new",
    "args": [
      "-n",
      "in",
      "out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "416047061",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "416047061",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520320a646f7332756e69783a20536b697070696e672062696e6172792066696c6520696e0a"
  },
  {
    "command": "dos2unix",
    "name": "binary-new-existing",
    "args": [
      "-n",
      "in",
      "out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "553707004",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "4f524947494e414c",
        "mode": 416,
        "inode": "553707005",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "553707004",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "4f524947494e414c",
        "mode": 416,
        "inode": "553707005",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520320a646f7332756e69783a20536b697070696e672062696e6172792066696c6520696e0a"
  },
  {
    "command": "dos2unix",
    "name": "utf16-error-old",
    "args": [
      "in"
    ],
    "inputHex": "",
    "locale": "C",
    "before": {
      "in": {
        "type": "file",
        "hex": "fffe41000d000a00e9000a00",
        "mode": 438,
        "inode": "692067638",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "fffe41000d000a00e9000a00",
        "mode": 438,
        "inode": "692067638",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20496e76616c6964206f7220696e636f6d706c657465206d756c746962797465206f722077696465206368617261637465720a646f7332756e69783a20536b697070696e67205554462d31362066696c6520696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520322e0a"
  },
  {
    "command": "dos2unix",
    "name": "utf16-error-new-existing",
    "args": [
      "-n",
      "in",
      "out"
    ],
    "inputHex": "",
    "locale": "C",
    "before": {
      "in": {
        "type": "file",
        "hex": "fffe41000d000a00e9000a00",
        "mode": 438,
        "inode": "56006320",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "4f524947494e414c",
        "mode": 416,
        "inode": "56006321",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "fffe41000d000a00e9000a00",
        "mode": 438,
        "inode": "56006320",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "4f524947494e414c",
        "mode": 416,
        "inode": "56006321",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20496e76616c6964206f7220696e636f6d706c657465206d756c746962797465206f722077696465206368617261637465720a646f7332756e69783a20536b697070696e67205554462d31362066696c6520696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520322e0a"
  },
  {
    "command": "dos2unix",
    "name": "missing-old",
    "args": [
      "missing"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a206d697373696e673a204e6f20737563682066696c65206f72206469726563746f72790a646f7332756e69783a20536b697070696e67206d697373696e672c206e6f74206120726567756c61722066696c652e0a"
  },
  {
    "command": "dos2unix",
    "name": "missing-quiet",
    "args": [
      "-q",
      "missing"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": ""
  },
  {
    "command": "dos2unix",
    "name": "missing-then-good",
    "args": [
      "missing",
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "416047065",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410a420a430d440d0a450d",
        "mode": 438,
        "inode": "416047078",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788722.2751
      }
    },
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a206d697373696e673a204e6f20737563682066696c65206f72206469726563746f72790a646f7332756e69783a20536b697070696e67206d697373696e672c206e6f74206120726567756c61722066696c652e0a646f7332756e69783a20636f6e76657274696e672066696c6520696e20746f20556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "dos2unix",
    "name": "new-option-between-pair",
    "args": [
      "-n",
      "in",
      "-b",
      "out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "efbbbf410d0a420a",
        "mode": 438,
        "inode": "692067640",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "efbbbf410d0a420a",
        "mode": 438,
        "inode": "692067640",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a202d623a204e6f20737563682066696c65206f72206469726563746f72790a646f7332756e69783a20536b697070696e67202d622c206e6f74206120726567756c61722066696c652e0a"
  },
  {
    "command": "dos2unix",
    "name": "new-old-unpaired",
    "args": [
      "-n",
      "in",
      "-o"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "56006323",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "56006323",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20746172676574206f662066696c6520696e206e6f742073706563696669656420696e206e65772d66696c65206d6f64650a646f7332756e69783a20746172676574206f662066696c65202d6f206e6f742073706563696669656420696e206e65772d66696c65206d6f64650a"
  },
  {
    "command": "dos2unix",
    "name": "new-missing-parent",
    "args": [
      "-n",
      "in",
      "absent/out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "295135576",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "295135576",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a204661696c656420746f206f70656e2074656d706f72617279206f75747075742066696c653a204e6f20737563682066696c65206f72206469726563746f72790a646f7332756e69783a2070726f626c656d7320636f6e76657274696e672066696c6520696e20746f2066696c6520616273656e742f6f75740a"
  },
  {
    "command": "dos2unix",
    "name": "literal-dash-file",
    "args": [
      "--",
      "-"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "-": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "565972743",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "-": {
        "type": "file",
        "hex": "410a420a430d440d0a450d",
        "mode": 438,
        "inode": "565981993",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788726.2751
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c65202d20746f20556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "dos2unix",
    "name": "stateful-bom-options",
    "args": [
      "first",
      "-r",
      "second"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "first": {
        "type": "file",
        "hex": "efbbbf410d0a420a",
        "mode": 438,
        "inode": "692067642",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "second": {
        "type": "file",
        "hex": "efbbbf410d0a420a",
        "mode": 438,
        "inode": "692067643",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "first": {
        "type": "file",
        "hex": "410a420a",
        "mode": 438,
        "inode": "692067644",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788726.2751
      },
      "second": {
        "type": "file",
        "hex": "410a420a",
        "mode": 438,
        "inode": "692067642",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788726.2751
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c6520666972737420746f20556e697820666f726d61742e2e2e0a646f7332756e69783a20636f6e76657274696e672066696c65207365636f6e6420746f20556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "dos2unix",
    "name": "hardlink-old",
    "args": [
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "alias": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "56006325",
        "links": 2,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "56006325",
        "links": 2,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "alias": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "56006325",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "in": {
        "type": "file",
        "hex": "410a420a430d440d0a450d",
        "mode": 438,
        "inode": "56006326",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788726.2751
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c6520696e20746f20556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "dos2unix",
    "name": "surrogate-state-across-files",
    "args": [
      "first",
      "second"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "first": {
        "type": "file",
        "hex": "fffe00d8",
        "mode": 438,
        "inode": "303828253",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "second": {
        "type": "file",
        "hex": "fffe00dc0a00",
        "mode": 438,
        "inode": "303828254",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "first": {
        "type": "file",
        "hex": "",
        "mode": 438,
        "inode": "303828259",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788730.2751
      },
      "second": {
        "type": "file",
        "hex": "f09080800a",
        "mode": 438,
        "inode": "303828253",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788730.2751
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e67205554462d31364c452066696c6520666972737420746f205554462d3820556e697820666f726d61742e2e2e0a646f7332756e69783a20636f6e76657274696e67205554462d31364c452066696c65207365636f6e6420746f205554462d3820556e697820666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "empty",
    "args": [],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "mixed",
    "args": [],
    "inputHex": "410d0a420a430d440d0d0a450d",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d0a420d0a430d440d0d0d0a450d",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "unterminated",
    "args": [],
    "inputHex": "41",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "41",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "trailing-cr",
    "args": [],
    "inputHex": "410d",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "double-crlf",
    "args": [],
    "inputHex": "0d0d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "0d0d0d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "newline-extra",
    "args": [
      "-l"
    ],
    "inputHex": "410d0a420a430d440d0d0a450d",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d0a420d0a0d0a430d440d0d0d0a450d",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "raw-high",
    "args": [],
    "inputHex": "4180ffc0af0d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "4180ffc0af0d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "all-bytes-force",
    "args": [
      "-f"
    ],
    "inputHex": "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "000102030405060708090d0a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "binary-stdin",
    "args": [],
    "inputHex": "410d0a4200430d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "410d0a42",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520320a756e697832646f733a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "unix2dos",
    "name": "binary-stdin-quiet",
    "args": [
      "-q"
    ],
    "inputHex": "410d0a4200430d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d0a42",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "binary-after-cr",
    "args": [],
    "inputHex": "410d00420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d00420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "binary-force",
    "args": [
      "-f"
    ],
    "inputHex": "410d0a4200430d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d0a4200430d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "force-then-safe",
    "args": [
      "-f",
      "-s"
    ],
    "inputHex": "410d0a4200430d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "410d0a42",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520320a756e697832646f733a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "unix2dos",
    "name": "safe-then-force",
    "args": [
      "-s",
      "-f"
    ],
    "inputHex": "410d0a4200430d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d0a4200430d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "control-0",
    "args": [],
    "inputHex": "4100420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520310a756e697832646f733a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "unix2dos",
    "name": "control-1",
    "args": [],
    "inputHex": "4101420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c203078303120666f756e64206174206c696e6520310a756e697832646f733a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "unix2dos",
    "name": "control-8",
    "args": [],
    "inputHex": "4108420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c203078303820666f756e64206174206c696e6520310a756e697832646f733a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "unix2dos",
    "name": "control-9",
    "args": [],
    "inputHex": "4109420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "4109420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "control-10",
    "args": [],
    "inputHex": "410a420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d0a420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "control-11",
    "args": [],
    "inputHex": "410b420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c203078304220666f756e64206174206c696e6520310a756e697832646f733a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "unix2dos",
    "name": "control-12",
    "args": [],
    "inputHex": "410c420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410c420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "control-13",
    "args": [],
    "inputHex": "410d420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "control-26",
    "args": [],
    "inputHex": "411a420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c203078314120666f756e64206174206c696e6520310a756e697832646f733a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "unix2dos",
    "name": "control-31",
    "args": [],
    "inputHex": "411f420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "41",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c203078314620666f756e64206174206c696e6520310a756e697832646f733a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "unix2dos",
    "name": "control-127",
    "args": [],
    "inputHex": "417f420d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "417f420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf8-bom-default",
    "args": [],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0a420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf8-bom-keep",
    "args": [
      "-b"
    ],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0a420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf8-bom-add",
    "args": [
      "-m"
    ],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0a420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf8-bom-remove",
    "args": [
      "-r"
    ],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d0a420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf8-bom-add-remove",
    "args": [
      "-m",
      "-r"
    ],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d0a420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf8-bom-remove-add",
    "args": [
      "-r",
      "-m"
    ],
    "inputHex": "efbbbf410d0a420a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0a420d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "add-bom-empty",
    "args": [
      "-m"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "keep-bom-absent",
    "args": [
      "-b"
    ],
    "inputHex": "410a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "embedded-bom",
    "args": [],
    "inputHex": "41efbbbf0d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "41efbbbf0d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "gb18030-bom",
    "args": [],
    "inputHex": "84319533410d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "84319533410d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "short-bom-ff",
    "args": [],
    "inputHex": "ff",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a2063616e206e6f7420726561642066726f6d20696e7075742066696c653a20537563636573730a"
  },
  {
    "command": "unix2dos",
    "name": "short-bom-efbb",
    "args": [],
    "inputHex": "efbb",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a2063616e206e6f7420726561642066726f6d20696e7075742066696c653a20537563636573730a"
  },
  {
    "command": "unix2dos",
    "name": "short-bom-ef",
    "args": [],
    "inputHex": "ef",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a2063616e206e6f7420726561642066726f6d20696e7075742066696c653a20537563636573730a"
  },
  {
    "command": "unix2dos",
    "name": "short-bom-gb-prefix",
    "args": [],
    "inputHex": "843195",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a2063616e206e6f7420726561642066726f6d20696e7075742066696c653a20537563636573730a"
  },
  {
    "command": "unix2dos",
    "name": "utf16-le",
    "args": [],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0ac3a90d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-le-C",
    "args": [],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0a",
    "stderrHex": "756e697832646f733a20496e76616c6964206f7220696e636f6d706c657465206d756c746962797465206f722077696465206368617261637465720a756e697832646f733a20536b697070696e67205554462d31362066696c6520737464696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520322e0a"
  },
  {
    "command": "unix2dos",
    "name": "utf16-le-keep",
    "args": [
      "-u"
    ],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "fffe41000d000a00e9000d000a00",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-le-keep-remove",
    "args": [
      "-u",
      "-r"
    ],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "41000d000a00e9000d000a00",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-le-keep-add",
    "args": [
      "-u",
      "-m"
    ],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "fffe41000d000a00e9000d000a00",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-be",
    "args": [],
    "inputHex": "feff0041000d000a00e9000a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0ac3a90d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-be-C",
    "args": [],
    "inputHex": "feff0041000d000a00e9000a",
    "locale": "C",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0a",
    "stderrHex": "756e697832646f733a20496e76616c6964206f7220696e636f6d706c657465206d756c746962797465206f722077696465206368617261637465720a756e697832646f733a20536b697070696e67205554462d31362066696c6520737464696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520322e0a"
  },
  {
    "command": "unix2dos",
    "name": "utf16-be-keep",
    "args": [
      "-u"
    ],
    "inputHex": "feff0041000d000a00e9000a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "feff0041000d000a00e9000d000a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-be-keep-remove",
    "args": [
      "-u",
      "-r"
    ],
    "inputHex": "feff0041000d000a00e9000a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "0041000d000a00e9000d000a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-be-keep-add",
    "args": [
      "-u",
      "-m"
    ],
    "inputHex": "feff0041000d000a00e9000a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "feff0041000d000a00e9000d000a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-assume-le",
    "args": [
      "-ul"
    ],
    "inputHex": "41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0ac3a90d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-assume-be",
    "args": [
      "-ub"
    ],
    "inputHex": "0041000d000a00e9000a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0ac3a90d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-bom-overrides-assumption",
    "args": [
      "-ub"
    ],
    "inputHex": "fffe41000d000a00e9000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0ac3a90d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-surrogate",
    "args": [],
    "inputHex": "fffe3dd800de0d000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbff09f98800d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-odd",
    "args": [],
    "inputHex": "fffe41000d000a0042",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf410d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-high-at-eof",
    "args": [],
    "inputHex": "fffe410000d8",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf41",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf16-low-alone",
    "args": [],
    "inputHex": "fffe410000dc0a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf41",
    "stderrHex": "756e697832646f733a206572726f723a20496e76616c696420737572726f6761746520706169722e204d697373696e67206869676820737572726f676174652e0a756e697832646f733a20536b697070696e67205554462d31362066696c6520737464696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520312e0a"
  },
  {
    "command": "unix2dos",
    "name": "utf16-high-then-ascii",
    "args": [],
    "inputHex": "fffe410000d842000a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "efbbbf41",
    "stderrHex": "756e697832646f733a206572726f723a20496e76616c696420737572726f6761746520706169722e204d697373696e67206c6f7720737572726f676174652e0a756e697832646f733a20536b697070696e67205554462d31362066696c6520737464696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520312e0a"
  },
  {
    "command": "unix2dos",
    "name": "utf16-keep-invalid",
    "args": [
      "-u"
    ],
    "inputHex": "fffe410000dc0a00",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "fffe410000dc0d000a00",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "utf32-le",
    "args": [],
    "inputHex": "fffe0000410000000a000000",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "efbbbf",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c2030783030303020666f756e64206174206c696e6520310a756e697832646f733a20536b697070696e672062696e6172792066696c6520737464696e0a"
  },
  {
    "command": "unix2dos",
    "name": "7bit",
    "args": [
      "-7"
    ],
    "inputHex": "4180ff0d0a",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "4120200d0a",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "missing-mode",
    "args": [
      "-c"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a206f7074696f6e20272d632720726571756972657320616e20617267756d656e740a"
  },
  {
    "command": "unix2dos",
    "name": "invalid-mode",
    "args": [
      "-c",
      "bad"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20696e76616c69642062616420636f6e76657273696f6e206d6f6465207370656369666965640a"
  },
  {
    "command": "unix2dos",
    "name": "new-no-operands",
    "args": [
      "-n"
    ],
    "inputHex": "410d0a420a430d440d0d0a450d",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "410d0a420d0a430d440d0d0d0a450d",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "new-unpaired",
    "args": [
      "-n",
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "685090760",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "685090760",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20746172676574206f662066696c6520696e206e6f742073706563696669656420696e206e65772d66696c65206d6f64650a"
  },
  {
    "command": "unix2dos",
    "name": "old-default",
    "args": [
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "56231572",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420d0a430d440d0d0d0a450d",
        "mode": 438,
        "inode": "56231573",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788798.276
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c6520696e20746f20444f5320666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "old-explicit",
    "args": [
      "-o",
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "311149951",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420d0a430d440d0d0d0a450d",
        "mode": 438,
        "inode": "311461235",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788798.276
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c6520696e20746f20444f5320666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "old-keepdate",
    "args": [
      "-k",
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "311650649",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420d0a430d440d0d0d0a450d",
        "mode": 438,
        "inode": "311650787",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c6520696e20746f20444f5320666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "old-umask77",
    "args": [
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "439077440",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420d0a430d440d0d0d0a450d",
        "mode": 438,
        "inode": "439077441",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788798.276
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c6520696e20746f20444f5320666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "new",
    "args": [
      "-n",
      "in",
      "out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "554123657",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "554123657",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "410d0a420d0a430d440d0d0d0a450d",
        "mode": 420,
        "inode": "554123658",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788802.276
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c6520696e20746f2066696c65206f757420696e20444f5320666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "new-replace",
    "args": [
      "-n",
      "in",
      "out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "311650649",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "4f524947494e414c",
        "mode": 384,
        "inode": "311938657",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "311650649",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "410d0a420d0a430d440d0d0d0a450d",
        "mode": 420,
        "inode": "311938658",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788802.276
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c6520696e20746f2066696c65206f757420696e20444f5320666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "new-same-path",
    "args": [
      "-n",
      "in",
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "312052288",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420d0a430d440d0d0d0a450d",
        "mode": 420,
        "inode": "312052289",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788802.276
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c6520696e20746f2066696c6520696e20696e20444f5320666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "binary-old",
    "args": [
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "312052290",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "312052290",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520320a756e697832646f733a20536b697070696e672062696e6172792066696c6520696e0a"
  },
  {
    "command": "unix2dos",
    "name": "binary-new",
    "args": [
      "-n",
      "in",
      "out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "439077442",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "439077442",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520320a756e697832646f733a20536b697070696e672062696e6172792066696c6520696e0a"
  },
  {
    "command": "unix2dos",
    "name": "binary-new-existing",
    "args": [
      "-n",
      "in",
      "out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "554123660",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "4f524947494e414c",
        "mode": 416,
        "inode": "554123661",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a4200430d0a",
        "mode": 438,
        "inode": "554123660",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "4f524947494e414c",
        "mode": 416,
        "inode": "554123661",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a2042696e6172792073796d626f6c203078303020666f756e64206174206c696e6520320a756e697832646f733a20536b697070696e672062696e6172792066696c6520696e0a"
  },
  {
    "command": "unix2dos",
    "name": "utf16-error-old",
    "args": [
      "in"
    ],
    "inputHex": "",
    "locale": "C",
    "before": {
      "in": {
        "type": "file",
        "hex": "fffe41000d000a00e9000a00",
        "mode": 438,
        "inode": "685090765",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "fffe41000d000a00e9000a00",
        "mode": 438,
        "inode": "685090765",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20496e76616c6964206f7220696e636f6d706c657465206d756c746962797465206f722077696465206368617261637465720a756e697832646f733a20536b697070696e67205554462d31362066696c6520696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520322e0a"
  },
  {
    "command": "unix2dos",
    "name": "utf16-error-new-existing",
    "args": [
      "-n",
      "in",
      "out"
    ],
    "inputHex": "",
    "locale": "C",
    "before": {
      "in": {
        "type": "file",
        "hex": "fffe41000d000a00e9000a00",
        "mode": 438,
        "inode": "312052292",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "4f524947494e414c",
        "mode": 416,
        "inode": "312052293",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "fffe41000d000a00e9000a00",
        "mode": 438,
        "inode": "312052292",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "out": {
        "type": "file",
        "hex": "4f524947494e414c",
        "mode": 416,
        "inode": "312052293",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20496e76616c6964206f7220696e636f6d706c657465206d756c746962797465206f722077696465206368617261637465720a756e697832646f733a20536b697070696e67205554462d31362066696c6520696e2c20616e205554462d313620636f6e76657273696f6e206572726f72206f63637572726564206f6e206c696e6520322e0a"
  },
  {
    "command": "unix2dos",
    "name": "missing-old",
    "args": [
      "missing"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a206d697373696e673a204e6f20737563682066696c65206f72206469726563746f72790a756e697832646f733a20536b697070696e67206d697373696e672c206e6f74206120726567756c61722066696c652e0a"
  },
  {
    "command": "unix2dos",
    "name": "missing-quiet",
    "args": [
      "-q",
      "missing"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {},
    "after": {},
    "status": 0,
    "stdoutHex": "",
    "stderrHex": ""
  },
  {
    "command": "unix2dos",
    "name": "missing-then-good",
    "args": [
      "missing",
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "439077444",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420d0a430d440d0d0d0a450d",
        "mode": 438,
        "inode": "439077445",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788806.276
      }
    },
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a206d697373696e673a204e6f20737563682066696c65206f72206469726563746f72790a756e697832646f733a20536b697070696e67206d697373696e672c206e6f74206120726567756c61722066696c652e0a756e697832646f733a20636f6e76657274696e672066696c6520696e20746f20444f5320666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "new-option-between-pair",
    "args": [
      "-n",
      "in",
      "-b",
      "out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "efbbbf410d0a420a",
        "mode": 438,
        "inode": "685090767",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "efbbbf410d0a420a",
        "mode": 438,
        "inode": "685090767",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a202d623a204e6f20737563682066696c65206f72206469726563746f72790a756e697832646f733a20536b697070696e67202d622c206e6f74206120726567756c61722066696c652e0a"
  },
  {
    "command": "unix2dos",
    "name": "new-old-unpaired",
    "args": [
      "-n",
      "in",
      "-o"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "312052297",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "312052297",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 1,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20746172676574206f662066696c6520696e206e6f742073706563696669656420696e206e65772d66696c65206d6f64650a756e697832646f733a20746172676574206f662066696c65202d6f206e6f742073706563696669656420696e206e65772d66696c65206d6f64650a"
  },
  {
    "command": "unix2dos",
    "name": "new-missing-parent",
    "args": [
      "-n",
      "in",
      "absent/out"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "312052299",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "312052299",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "status": 2,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a204661696c656420746f206f70656e2074656d706f72617279206f75747075742066696c653a204e6f20737563682066696c65206f72206469726563746f72790a756e697832646f733a2070726f626c656d7320636f6e76657274696e672066696c6520696e20746f2066696c6520616273656e742f6f75740a"
  },
  {
    "command": "unix2dos",
    "name": "literal-dash-file",
    "args": [
      "--",
      "-"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "-": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "554123665",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "-": {
        "type": "file",
        "hex": "410d0a420d0a430d440d0d0d0a450d",
        "mode": 438,
        "inode": "554123666",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788814.276
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c65202d20746f20444f5320666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "stateful-bom-options",
    "args": [
      "first",
      "-r",
      "second"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "first": {
        "type": "file",
        "hex": "efbbbf410d0a420a",
        "mode": 438,
        "inode": "685090769",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "second": {
        "type": "file",
        "hex": "efbbbf410d0a420a",
        "mode": 438,
        "inode": "685090770",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "first": {
        "type": "file",
        "hex": "efbbbf410d0a420d0a",
        "mode": 438,
        "inode": "685090771",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788814.276
      },
      "second": {
        "type": "file",
        "hex": "410d0a420d0a",
        "mode": 438,
        "inode": "685090769",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788814.276
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c6520666972737420746f20444f5320666f726d61742e2e2e0a756e697832646f733a20636f6e76657274696e672066696c65207365636f6e6420746f20444f5320666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "hardlink-old",
    "args": [
      "in"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "alias": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "312052304",
        "links": 2,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "in": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "312052304",
        "links": 2,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "alias": {
        "type": "file",
        "hex": "410d0a420a430d440d0d0a450d",
        "mode": 438,
        "inode": "312052304",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "in": {
        "type": "file",
        "hex": "410d0a420d0a430d440d0d0d0a450d",
        "mode": 438,
        "inode": "312052305",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788814.276
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c6520696e20746f20444f5320666f726d61742e2e2e0a"
  },
  {
    "command": "unix2dos",
    "name": "surrogate-state-across-files",
    "args": [
      "first",
      "second"
    ],
    "inputHex": "",
    "locale": "C.UTF-8",
    "before": {
      "first": {
        "type": "file",
        "hex": "fffe00d8",
        "mode": 438,
        "inode": "312052307",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      },
      "second": {
        "type": "file",
        "hex": "fffe00dc0a00",
        "mode": 438,
        "inode": "312052308",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 946684800000
      }
    },
    "after": {
      "first": {
        "type": "file",
        "hex": "efbbbf",
        "mode": 438,
        "inode": "312052309",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788814.276
      },
      "second": {
        "type": "file",
        "hex": "efbbbff09080800d0a",
        "mode": 438,
        "inode": "312052307",
        "links": 1,
        "uid": 150124,
        "gid": 150124,
        "mtimeMs": 1789013788814.276
      }
    },
    "status": 0,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e67205554462d31364c452066696c6520666972737420746f205554462d3820444f5320666f726d61742e2e2e0a756e697832646f733a20636f6e76657274696e67205554462d31364c452066696c65207365636f6e6420746f205554462d3820444f5320666f726d61742e2e2e0a"
  }
] as const;
