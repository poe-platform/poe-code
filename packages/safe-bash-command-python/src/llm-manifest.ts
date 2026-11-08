/** Pinned Python distributions and authenticated build-time assets. */
export const pythonLlmManifest = {
  "llm": "0.27.1",
  "pyodide": "314.0.6",
  "distributions": [
    {
      "name": "llm",
      "version": "0.27.1",
      "url": "https://files.pythonhosted.org/packages/6c/67/47585c961ff2299749e519891681025c2685b75801e3f784ee232853c5b0/llm-0.27.1-py3-none-any.whl",
      "sha256": "a884a575062fbea8c2b129708a80e146fa9682bd1c444d8d7b028196107de727",
      "bytes": 82500,
      "expandedBytes": 348753,
      "nativeModules": [],
      "file": "llm-0.27.1-py3-none-any.whl"
    },
    {
      "name": "pydantic",
      "version": "2.12.5",
      "url": "https://files.pythonhosted.org/packages/5a/87/b70ad306ebb6f9b585f114d0ac2137d792b48be34d732d60e597c2f8465a/pydantic-2.12.5-py3-none-any.whl",
      "sha256": "e561593fccf61e8a20fc46dfc2dfe075b8be7d0188df33f221ad1f0139180f9d",
      "bytes": 463580,
      "expandedBytes": 1851456,
      "nativeModules": [],
      "file": "pydantic-2.12.5-py3-none-any.whl"
    },
    {
      "name": "pydantic-core",
      "version": "2.41.5",
      "url": "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pydantic_core-2.41.5-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
      "sha256": "9802bd7a5e6679ec4c13be778f19f021e6147459c89cc916b913f7970f86dddb",
      "bytes": 1310163,
      "expandedBytes": 4592549,
      "nativeModules": [
        {
          "path": "pydantic_core/_pydantic_core.cpython-314-wasm32-emscripten.so",
          "bytes": 4275289,
          "sha256": "94477475eb48c67b6b25fd47a7955c1d01479f7971522aff90215bb517be8246"
        }
      ],
      "file": "pydantic_core-2.41.5-cp314-cp314-pyemscripten_2026_0_wasm32.whl"
    },
    {
      "name": "httpx",
      "version": "0.28.1",
      "url": "https://files.pythonhosted.org/packages/2a/39/e50c7c3a983047577ee07d2a9e53faf5a69493943ec3f6a384bdc792deb2/httpx-0.28.1-py3-none-any.whl",
      "sha256": "d909fcccc110f8c7faf814ca82a9a4d816bc5a6dbfea25d6591d6985b8ba59ad",
      "bytes": 73517,
      "expandedBytes": 295303,
      "nativeModules": [],
      "file": "httpx-0.28.1-py3-none-any.whl"
    },
    {
      "name": "click",
      "version": "8.1.8",
      "url": "https://files.pythonhosted.org/packages/7e/d4/7ebdbd03970677812aac39c869717059dbb71a4cfc033ca6e5221787892c/click-8.1.8-py3-none-any.whl",
      "sha256": "63c132bbbed01578a06712a2d1f497bb62d9c1c0d329b7903a866228027263b2",
      "bytes": 98188,
      "expandedBytes": 355272,
      "nativeModules": [],
      "file": "click-8.1.8-py3-none-any.whl"
    },
    {
      "name": "sqlite-utils",
      "version": "3.38",
      "url": "https://files.pythonhosted.org/packages/4d/eb/f8e8e827805f810838efff3311cccd2601238c5fa3fc35c1f878709e161b/sqlite_utils-3.38-py3-none-any.whl",
      "sha256": "8a27441015c3b2ef475f555861f7a2592f73bc60d247af9803a11b65fc605bf9",
      "bytes": 68183,
      "expandedBytes": 278821,
      "nativeModules": [],
      "file": "sqlite_utils-3.38-py3-none-any.whl"
    },
    {
      "name": "sqlite-migrate",
      "version": "0.1b0",
      "url": "https://files.pythonhosted.org/packages/df/92/994545b912e6d6feb40323047f02ca039321e690aa2c27afcd5c4105e37b/sqlite_migrate-0.1b0-py3-none-any.whl",
      "sha256": "a4125e35e1de3dc56b6b6ec60e9833ce0ce20192b929ddcb2d4246c5098859c6",
      "bytes": 9986,
      "expandedBytes": 25349,
      "nativeModules": [],
      "file": "sqlite_migrate-0.1b0-py3-none-any.whl"
    },
    {
      "name": "python-ulid",
      "version": "3.0.0",
      "url": "https://files.pythonhosted.org/packages/63/4e/cc2ba2c0df2589f35a4db8473b8c2ba9bbfc4acdec4a94f1c78934d2350f/python_ulid-3.0.0-py3-none-any.whl",
      "sha256": "e4c4942ff50dbd79167ad01ac725ec58f924b4018025ce22c858bfcff99a5e31",
      "bytes": 11194,
      "expandedBytes": 30439,
      "nativeModules": [],
      "file": "python_ulid-3.0.0-py3-none-any.whl"
    },
    {
      "name": "condense-json",
      "version": "0.1.3",
      "url": "https://files.pythonhosted.org/packages/28/5f/63badd4924358fad1efa6defd66eef700ccf8783c0e44098987f867e8b1f/condense_json-0.1.3-py3-none-any.whl",
      "sha256": "e0a3d42db4f44a89e74af8737d8e517e97420be0f7e5437087f4decfd38c3366",
      "bytes": 8432,
      "expandedBytes": 21056,
      "nativeModules": [],
      "file": "condense_json-0.1.3-py3-none-any.whl"
    },
    {
      "name": "puremagic",
      "version": "1.30",
      "url": "https://files.pythonhosted.org/packages/91/ed/1e347d85d05b37a8b9a039ca832e5747e1e5248d0bd66042783ef48b4a37/puremagic-1.30-py3-none-any.whl",
      "sha256": "5eeeb2dd86f335b9cfe8e205346612197af3500c6872dffebf26929f56e9d3c1",
      "bytes": 43304,
      "expandedBytes": 185153,
      "nativeModules": [],
      "file": "puremagic-1.30-py3-none-any.whl"
    },
    {
      "name": "anyio",
      "version": "4.15.1",
      "url": "https://files.pythonhosted.org/packages/12/b8/4bd346e22b28902df4d651910f5242c28d84e4a5c2435ca5c3f797ed7e2e/anyio-4.15.1-py3-none-any.whl",
      "sha256": "6152fdbbf9a77fdec97731721bebf7c4c44f7c29b424b0065826173efc7ed101",
      "bytes": 132079,
      "expandedBytes": 539217,
      "nativeModules": [],
      "file": "anyio-4.15.1-py3-none-any.whl"
    },
    {
      "name": "httpcore",
      "version": "1.0.9",
      "url": "https://files.pythonhosted.org/packages/7e/f5/f66802a942d491edb555dd61e3a9961140fd64c90bce1eafd741609d334d/httpcore-1.0.9-py3-none-any.whl",
      "sha256": "2d400746a40668fc9dec9810239072b40b4484b640a8c38fd654a024c7a1bf55",
      "bytes": 78784,
      "expandedBytes": 288016,
      "nativeModules": [],
      "file": "httpcore-1.0.9-py3-none-any.whl"
    },
    {
      "name": "typing-extensions",
      "version": "4.16.0",
      "url": "https://files.pythonhosted.org/packages/49/d3/b8441a820a491ddfc024b0b0cf0393375b75ea13866d9c66727e54c2fc80/typing_extensions-4.16.0-py3-none-any.whl",
      "sha256": "481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8",
      "bytes": 45571,
      "expandedBytes": 182767,
      "nativeModules": [],
      "file": "typing_extensions-4.16.0-py3-none-any.whl"
    },
    {
      "name": "annotated-types",
      "version": "0.8.0",
      "url": "https://files.pythonhosted.org/packages/99/91/8acff4f5e50511b911bbccb72b8628a49c68ce14148cd9f6431094859a90/annotated_types-0.8.0-py3-none-any.whl",
      "sha256": "f072f4d804ea359e4eaf198b1af7a8b0943881a87f31bb764f8bf219bb9419e0",
      "bytes": 13427,
      "expandedBytes": 36347,
      "nativeModules": [],
      "file": "annotated_types-0.8.0-py3-none-any.whl"
    },
    {
      "name": "click-default-group",
      "version": "1.2.4",
      "url": "https://files.pythonhosted.org/packages/2c/1a/aff8bb287a4b1400f69e09a53bd65de96aa5cee5691925b38731c67fc695/click_default_group-1.2.4-py2.py3-none-any.whl",
      "sha256": "9b60486923720e7fc61731bdb32b617039aba820e22e1c88766b1125592eaa5f",
      "bytes": 4123,
      "expandedBytes": 8671,
      "nativeModules": [],
      "file": "click_default_group-1.2.4-py2.py3-none-any.whl"
    },
    {
      "name": "h11",
      "version": "0.16.0",
      "url": "https://files.pythonhosted.org/packages/04/4b/29cac41a4d98d144bf5f6d33995617b185d14b22401f75ca86f384e87ff1/h11-0.16.0-py3-none-any.whl",
      "sha256": "63cf8bbe7522de3bf65932fda1d9c2772064ffb3dae62d55932da54b31cb6c86",
      "bytes": 37515,
      "expandedBytes": 103935,
      "nativeModules": [],
      "file": "h11-0.16.0-py3-none-any.whl"
    },
    {
      "name": "idna",
      "version": "3.20",
      "url": "https://files.pythonhosted.org/packages/58/a2/bb081bab032533a855d44de1d56f8e8426114ff1ba5d1f07a438a0a654f8/idna-3.20-py3-none-any.whl",
      "sha256": "ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c",
      "bytes": 69583,
      "expandedBytes": 342091,
      "nativeModules": [],
      "file": "idna-3.20-py3-none-any.whl"
    },
    {
      "name": "typing-inspection",
      "version": "0.4.4",
      "url": "https://files.pythonhosted.org/packages/67/81/4add07e5172b7ac40d8ed5ff580409a7801a4fe26d529bdd915401dabfbe/typing_inspection-0.4.4-py3-none-any.whl",
      "sha256": "65b8397ba37ccbce054456aaccddfc91e6e3083c92824df348d96ca832f3f147",
      "bytes": 14750,
      "expandedBytes": 54538,
      "nativeModules": [],
      "file": "typing_inspection-0.4.4-py3-none-any.whl"
    },
    {
      "name": "certifi",
      "version": "2026.7.22",
      "url": "https://files.pythonhosted.org/packages/0b/a7/71ac2cff56fec219ed242bb11b8efb69fcc4bec75db06fb7bfe35de520e6/certifi-2026.7.22-py3-none-any.whl",
      "sha256": "62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775",
      "bytes": 136983,
      "expandedBytes": 248921,
      "nativeModules": [],
      "file": "certifi-2026.7.22-py3-none-any.whl"
    },
    {
      "name": "pluggy",
      "version": "1.6.0",
      "url": "https://files.pythonhosted.org/packages/54/20/4d324d65cc6d9205fabedc306948156824eb9f0ee1633355a8f7ec5c66bf/pluggy-1.6.0-py3-none-any.whl",
      "sha256": "e920276dd6813095e9377c0bc5566d94c932c33b27a3e3945d8389c374dd4746",
      "bytes": 20538,
      "expandedBytes": 65823,
      "nativeModules": [],
      "file": "pluggy-1.6.0-py3-none-any.whl"
    },
    {
      "name": "python-dateutil",
      "version": "2.9.0.post0",
      "url": "https://files.pythonhosted.org/packages/ec/57/56b9bcc3c9c6a792fcbaf139543cee77261f3651ca9da0c93f5c1221264b/python_dateutil-2.9.0.post0-py2.py3-none-any.whl",
      "sha256": "a8b2bc7bffae282281c8140a97d3aa9c14da0b136dfe83f850eea9a5f7470427",
      "bytes": 229892,
      "expandedBytes": 441579,
      "nativeModules": [],
      "file": "python_dateutil-2.9.0.post0-py2.py3-none-any.whl"
    },
    {
      "name": "six",
      "version": "1.17.0",
      "url": "https://files.pythonhosted.org/packages/b7/ce/149a00dd41f10bc29e5921b496af8b574d8413afcd5e30dfa0ed46c2cc5e/six-1.17.0-py2.py3-none-any.whl",
      "sha256": "4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274",
      "bytes": 11050,
      "expandedBytes": 37975,
      "nativeModules": [],
      "file": "six-1.17.0-py2.py3-none-any.whl"
    },
    {
      "name": "pyyaml",
      "version": "6.0.3",
      "url": "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyyaml-6.0.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
      "sha256": "b1447216501f0d3aef290558fe33691dd51b0839e70f9a970defb12b36d82df8",
      "bytes": 111318,
      "expandedBytes": 439274,
      "nativeModules": [
        {
          "path": "yaml/_yaml.cpython-314-wasm32-emscripten.so",
          "bytes": 214986,
          "sha256": "a3b18ccfd3c043f10f4ae4044bea14079f14a30707bf5c6ddf1f6dc61abaffc1"
        }
      ],
      "file": "pyyaml-6.0.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl"
    },
    {
      "name": "sniffio",
      "version": "1.3.1",
      "url": "https://files.pythonhosted.org/packages/e9/44/75a9c9421471a6c4805dbf2356f7c181a29c1879239abab1ea2cc8f38b40/sniffio-1.3.1-py3-none-any.whl",
      "sha256": "2f6da418d1f1e0fddd844478f41680e794e6051915791a034ff65e5f100525a2",
      "bytes": 10235,
      "expandedBytes": 22921,
      "nativeModules": [],
      "file": "sniffio-1.3.1-py3-none-any.whl"
    },
    {
      "name": "sqlite-fts4",
      "version": "1.0.3",
      "url": "https://files.pythonhosted.org/packages/51/29/0096e8b1811aaa78cfb296996f621f41120c21c2f5cd448ae1d54979d9fc/sqlite_fts4-1.0.3-py3-none-any.whl",
      "sha256": "0359edd8dea6fd73c848989e1e2b1f31a50fe5f9d7272299ff0e8dbaa62d035f",
      "bytes": 9972,
      "expandedBytes": 28735,
      "nativeModules": [],
      "file": "sqlite_fts4-1.0.3-py3-none-any.whl"
    },
    {
      "name": "tabulate",
      "version": "0.10.0",
      "url": "https://files.pythonhosted.org/packages/99/55/db07de81b5c630da5cbf5c7df646580ca26dfaefa593667fc6f2fe016d2e/tabulate-0.10.0-py3-none-any.whl",
      "sha256": "f0b0622e567335c8fabaaa659f1b33bcb6ddfe2e496071b743aa113f8774f2d3",
      "bytes": 39814,
      "expandedBytes": 150857,
      "nativeModules": [],
      "file": "tabulate-0.10.0-py3-none-any.whl"
    }
  ]
};
