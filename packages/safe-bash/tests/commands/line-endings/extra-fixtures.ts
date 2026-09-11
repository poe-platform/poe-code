export const extraNativeCases = [
  {
    "command": "dos2unix",
    "name": "short-bom-file",
    "args": [
      "in"
    ],
    "files": {
      "in": "efbb"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a2063616e206e6f7420726561642066726f6d20696e7075742066696c653a20537563636573730a646f7332756e69783a2070726f626c656d7320636f6e76657274696e672066696c6520696e0a",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "efbb"
      }
    }
  },
  {
    "command": "dos2unix",
    "name": "quiet-short-bom-file",
    "args": [
      "-q",
      "in"
    ],
    "files": {
      "in": "efbb"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "efbb"
      }
    }
  },
  {
    "command": "dos2unix",
    "name": "quiet-utf16-error",
    "args": [
      "-q",
      "in"
    ],
    "files": {
      "in": "fffe410000dc"
    },
    "status": 1,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a206572726f723a20496e76616c696420737572726f6761746520706169722e204d697373696e67206869676820737572726f676174652e0a",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "fffe410000dc"
      }
    }
  },
  {
    "command": "dos2unix",
    "name": "symlink-old-skip",
    "args": [
      "link"
    ],
    "files": {
      "in": "410d0a"
    },
    "links": {
      "link": "in"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20536b697070696e672073796d626f6c6963206c696e6b206c696e6b2e0a",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "410d0a"
      },
      "link": {
        "type": "symlink",
        "mode": 511
      }
    }
  },
  {
    "command": "dos2unix",
    "name": "symlink-new-input",
    "args": [
      "-n",
      "link",
      "out"
    ],
    "files": {
      "in": "410d0a"
    },
    "links": {
      "link": "in"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c65206c696e6b20746f2066696c65206f757420696e20556e697820666f726d61742e2e2e0a",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "410d0a"
      },
      "link": {
        "type": "symlink",
        "mode": 511
      },
      "out": {
        "type": "file",
        "mode": 420,
        "hex": "410a"
      }
    }
  },
  {
    "command": "dos2unix",
    "name": "symlink-new-output-skip",
    "args": [
      "-n",
      "in",
      "link"
    ],
    "files": {
      "in": "410d0a",
      "target": "73656e74696e656c"
    },
    "links": {
      "link": "target"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20536b697070696e6720696e2c206f75747075742066696c65206c696e6b20697320612073796d626f6c6963206c696e6b2e0a",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "410d0a"
      },
      "link": {
        "type": "symlink",
        "mode": 511
      },
      "target": {
        "type": "file",
        "mode": 420,
        "hex": "73656e74696e656c"
      }
    }
  },
  {
    "command": "dos2unix",
    "name": "directory-input-skip",
    "args": [
      "dir"
    ],
    "files": {},
    "directories": [
      "dir"
    ],
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20536b697070696e67206469722c206e6f74206120726567756c61722066696c652e0a",
    "after": {
      "dir": {
        "type": "directory",
        "mode": 509
      }
    }
  },
  {
    "command": "dos2unix",
    "name": "new-pair-double-dash",
    "args": [
      "-n",
      "in",
      "--",
      "out"
    ],
    "files": {
      "in": "410d0a",
      "--": "420d0a"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "646f7332756e69783a20636f6e76657274696e672066696c65202d2d20746f2066696c65206f757420696e20556e697820666f726d61742e2e2e0a",
    "after": {
      "--": {
        "type": "file",
        "mode": 420,
        "hex": "420d0a"
      },
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "410d0a"
      },
      "out": {
        "type": "file",
        "mode": 420,
        "hex": "420a"
      }
    }
  },
  {
    "command": "unix2dos",
    "name": "short-bom-file",
    "args": [
      "in"
    ],
    "files": {
      "in": "efbb"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a2063616e206e6f7420726561642066726f6d20696e7075742066696c653a20537563636573730a756e697832646f733a2070726f626c656d7320636f6e76657274696e672066696c6520696e0a",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "efbb"
      }
    }
  },
  {
    "command": "unix2dos",
    "name": "quiet-short-bom-file",
    "args": [
      "-q",
      "in"
    ],
    "files": {
      "in": "efbb"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "efbb"
      }
    }
  },
  {
    "command": "unix2dos",
    "name": "quiet-utf16-error",
    "args": [
      "-q",
      "in"
    ],
    "files": {
      "in": "fffe410000dc"
    },
    "status": 1,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a206572726f723a20496e76616c696420737572726f6761746520706169722e204d697373696e67206869676820737572726f676174652e0a",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "fffe410000dc"
      }
    }
  },
  {
    "command": "unix2dos",
    "name": "symlink-old-skip",
    "args": [
      "link"
    ],
    "files": {
      "in": "410d0a"
    },
    "links": {
      "link": "in"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20536b697070696e672073796d626f6c6963206c696e6b206c696e6b2e0a",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "410d0a"
      },
      "link": {
        "type": "symlink",
        "mode": 511
      }
    }
  },
  {
    "command": "unix2dos",
    "name": "symlink-new-input",
    "args": [
      "-n",
      "link",
      "out"
    ],
    "files": {
      "in": "410d0a"
    },
    "links": {
      "link": "in"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c65206c696e6b20746f2066696c65206f757420696e20444f5320666f726d61742e2e2e0a",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "410d0a"
      },
      "link": {
        "type": "symlink",
        "mode": 511
      },
      "out": {
        "type": "file",
        "mode": 420,
        "hex": "410d0a"
      }
    }
  },
  {
    "command": "unix2dos",
    "name": "symlink-new-output-skip",
    "args": [
      "-n",
      "in",
      "link"
    ],
    "files": {
      "in": "410d0a",
      "target": "73656e74696e656c"
    },
    "links": {
      "link": "target"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20536b697070696e6720696e2c206f75747075742066696c65206c696e6b20697320612073796d626f6c6963206c696e6b2e0a",
    "after": {
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "410d0a"
      },
      "link": {
        "type": "symlink",
        "mode": 511
      },
      "target": {
        "type": "file",
        "mode": 420,
        "hex": "73656e74696e656c"
      }
    }
  },
  {
    "command": "unix2dos",
    "name": "directory-input-skip",
    "args": [
      "dir"
    ],
    "files": {},
    "directories": [
      "dir"
    ],
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20536b697070696e67206469722c206e6f74206120726567756c61722066696c652e0a",
    "after": {
      "dir": {
        "type": "directory",
        "mode": 509
      }
    }
  },
  {
    "command": "unix2dos",
    "name": "new-pair-double-dash",
    "args": [
      "-n",
      "in",
      "--",
      "out"
    ],
    "files": {
      "in": "410d0a",
      "--": "420d0a"
    },
    "status": 0,
    "signal": null,
    "error": null,
    "stdoutHex": "",
    "stderrHex": "756e697832646f733a20636f6e76657274696e672066696c65202d2d20746f2066696c65206f757420696e20444f5320666f726d61742e2e2e0a",
    "after": {
      "--": {
        "type": "file",
        "mode": 420,
        "hex": "420d0a"
      },
      "in": {
        "type": "file",
        "mode": 420,
        "hex": "410d0a"
      },
      "out": {
        "type": "file",
        "mode": 420,
        "hex": "420d0a"
      }
    }
  }
] as const;
