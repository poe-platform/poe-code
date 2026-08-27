# DU native differences: complete read-only classification

Date: August 27, 2026. Source 877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3; author evidence f2d6f710d9e0b9481957ff302bba90a0f11c9bad; independent evidence 19cc7e8c3567b521e04159010efe32da5673b5b4.

No source, test, evidence, index or commit modifications by this task. No whole cohort was rerun. Only three native ordering cases were corroborated in a cleaned task-owned /tmp fixture. Full exact machine-readable records are in raw-cases.json beside this report.

Missing exports / exit 127 were intentionally withheld integration, not an unexpected module defect. They are outside these 18 native differences. No native expected output was changed or weakened.

## Bottom line

The original 15 consist of 12 real stderr compatibility differences with equal status/stdout, two full invalid-environment behavior differences, and one directory-output cardinality difference. The three new cases are stream-order differences on the same Real-backed fixture, not allocation arithmetic differences. None of the twelve diagnostic cases masks a successful native feature rejected by DU for those exact inputs. The environment and repeated-directory cases MUST NOT be reduced to diagnostics-only. Intentional implementation choices remain measurable compatibility gaps, not automatic waivers.

## Groups and minimal proposals (not approved or applied)

### G1: Redundant summary/depth warning omitted

Cases: O052.

Classification: Avoidable stderr compatibility gap, not rejection or arithmetic gap.

Root cause: GNU du.c:919 emits a warning for summarize plus max-depth=0 and continues successfully. arguments.ts:82-98 accepts the pair but has no warning representation or emission.

Minimal proposal: If GNU stderr compatibility is desired, return a structured nonfatal warning from parsing and emit it through bounded awaited stderr after all arguments are validated, preserving status 0.

### G2: Conflicting options / unknown option diagnostics

Cases: O053, O054, O063.

Classification: Equivalent invalid-invocation rejection with avoidable wording and program-name-profile differences.

Root cause: Both parsers reject -as, -s -d1 and --unsupported before traversal. GNU du.c:913-930 emits diagnostics plus usage; getopt handles unknown option. DU arguments.ts uses UsageError messages, budget.diagnostic uses a fixed du prefix and no usage trailer. GNU warning wording in -s -d1 still accompanies exit 1.

Minimal proposal: Align semantic diagnostic messages and usage policy without changing rejection or parse-before-effects. Decide an argv[0]/program-display-name policy before claiming exact stderr: the captured GNU help suggestion contains the absolute oracle path; do not fake a host path in the virtual command.

### G3: Missing operand / zero-length operand diagnostics

Cases: O061, O062.

Classification: Equivalent failure and continuation, with meaningful but bounded diagnostic-category differences.

Root cause: GNU du.c:513 renders cannot-access + system errno; DU wraps typed FsError with JSON-quoted display and virtual lstat path. GNU du.c:1077 rejects empty names before fts; DU du.ts:82 synthesizes ENOENT before lstat, obscuring invalid-input versus nonexistent-entry semantics in text, but still performs no empty-root lookup and returns 1.

Minimal proposal: Give empty operands their own diagnostic. Render ENOENT by typed code where GNU-style diagnostics are requested; preserve actual error kind/path and later-operand continuation, not blanket message replacement.

### G4: Explicit invalid -B values

Cases: O073, O074, O075, O076, O079, O080.

Classification: All six inputs rejected by both; no missing successful GNU functionality demonstrated by these cases.

Root cause: b/-1/1.5K fail DU regex; 0 fails positivity; Q and 1Q pass DU suffix recognition then exceed safe unit range. Pinned human.c uses suffix list eEgGkKmMpPtTyYzZ0, with no Q. GNU therefore rejects bare Q as invalid argument and 1Q as invalid suffix, rather than demonstrating successful huge-unit support. GNU du.c:843-846 calls xstrtol_fatal on explicit -B errors; DU messages differ.

Minimal proposal: Improve error categories/text if exact diagnostic behavior is required. Do not broaden accepted grammar merely to make these six rejected cases green. Other unmeasured valid GNU formats or larger units require separate coverage and policy; these six do not waive those gaps.

### G5: Invalid selected environment blocks an otherwise usable request

Cases: O086, O087.

Classification: Two real, avoidable GNU-behavior gaps from an implemented strict choice; not diagnostics-only and not allocation-provider refusal.

Root cause: GNU du.c:735 ignores the error returned by human_options for environment initialization; static output_block_size starts zero, and human.c:464-472 installs the 1024 default for these invalid/empty specifications. Empty DU_BLOCK_SIZE is set, so BLOCK_SIZE=2K is not consulted. DU arguments.ts:84-94 sends the selected value to throwing blockSize; execution aborts before metadata and output.

Minimal proposal: For GNU-compatible policy, default only invalid selected environment format to 1024 (512 with explicit context POSIXLY_CORRECT). Do not fall through to lower-priority BLOCK_SIZE in the empty-DU case; do not swallow resource/cancellation errors, accept invalid explicit -B, read ambient process env, or introduce size fallback for unknown allocation. Keeping strict mode is a documented incompatibility needing policy approval, not a native pass.

### G6: Repeated stable directory operand produces extra zero rows

Cases: O060.

Classification: Real directory-reporting/cardinality difference from conservative namespace design, not a different-provider excuse for this fixture.

Root cause: GNU enables hash_all for multiple operands (du.c:1026), hashes directories too, then FTS_SKIP prunes the repeated directory and its postorder output (du.c:529-542). DU duplicate() returns false for directories (du.ts:16), walks both operands in order, deduplicates their files and emits zero directory totals on the second walk. Both tree operands here refer to the same unchanged Memory namespace; they are not different mount views.

Minimal proposal: Do not globally deduplicate directory dev/ino: that breaks distinct mounted namespaces. If GNU repeated-operand output is required, design a narrowly bounded same-operand reporting policy while retaining traversal, and define stable-namespace/error/change semantics. A path-only shortcut or blanket GNU inode pruning is not a safe minimal general fix. Current conservative behavior protects broader namespaces but remains an observable gap on this exact stable fixture.

### G7: Native small-directory order differs from provider/DU lexicographic order

Cases: N002, N014, N017.

Classification: Three exact-stream ordering gaps; matching sizes, row multiplicities, empty stderr and status 0; no allocation/arithmetic gap.

Root cause: GNU calls xfts_open with a null comparator (du.c:663); gnulib FTS appends readdir entries in directory order for this three-entry directory. The 10000-entry inode-sort optimization does not apply. Frozen native output uses cycle,deep,b under tree/sub. In bounded corroboration Node opendir gives cycle,deep,b while Node readdir gives b,cycle,deep. RealFileSystem.readdir directly forwards Node readdir entries (real/index.ts:286-291), and DU also sorts UTF-16 code units (du.ts:68-70).

Minimal proposal: Choose whether exact native stream order is a requirement. If so, removing DU sort alone is insufficient for Real on this host: an approved provider native-enumeration path and command ordering policy are both needed, with validation/bounds preserved. Do not promise general GNU ordering across hosts/large directories, or relabel the present sorted stream as exact native parity. Order matters to downstream head/first-record consumers.

## Exact context and fixture reconstruction

IMPORTANT evidence limit: the original 87 native capture does not record its mkdtemp random cwd suffix. The driver and capture location establish the task-owned parent/pattern, not the exact cleaned pathname. This report marks that field unknown rather than inventing it. The new-115 physical cwd is recoverable from its mapped-root raw output. DU context cwd and exported PWD are both /, authenticated from the Shell/helper source; native environment is the explicit PATH/LC_ALL plus case overlay, not the parent environment.

The independent Memory seed changed abc/12345 content to zero bytes of the same lengths. That is explicitly a byte-fixture delta, although the author and independent raw results are identical in all 87 records and all 15 differing cases use logical metadata, not file reads. Native size files were sparse/truncated while Memory size files were dense zero arrays. Unknown allocation is not the cause of any of the 15 original differences.

```json
{
  "original": {
    "native": {
      "provider": "Host filesystem accessed by authenticated GNU du 9.7 on Darwin",
      "cwdExact": null,
      "cwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
      "cwdQualification": "The original capture driver sets cwd to mkdtemp(output/fixture-), but profile.json omits the random path. It was cleaned. Do not invent it.",
      "baseEnvironment": {
        "PATH": "/usr/bin:/bin",
        "LC_ALL": "C"
      },
      "environmentRule": "Add native.env from the exact case. No inherited process environment and no explicit PWD.",
      "fixtures": {
        "tree": {
          "tree/sub": "directory",
          "tree/a": "bytes 61 62 63 (abc), length 3",
          "tree/sub/b": "bytes 31 32 33 34 35 (12345), length 5"
        },
        "alias": "hardlink to tree/a",
        "link": "symlink target tree",
        "broken": "symlink target absent",
        "sizes": [
          0,
          1,
          1023,
          1024,
          1025,
          10239,
          10240,
          10241,
          1048575,
          1048576,
          1048577
        ],
        "sizeFiles": "size-N created empty then truncated to N; zero-filled sparse logical contents; allocation not measured by these apparent-size cases",
        "missing": "No missing entry; absent symlink target does not exist",
        "emptyOperand": "The empty string is invalid input; it is not a request to measure the root"
      }
    },
    "du": {
      "provider": "MemoryFileSystem via actual Shell plus built/source DU plugin; not Real allocation",
      "cwd": "/",
      "contextEnvironmentRule": "Exactly case.env plus exported PWD=/; no ambient PATH/LC_ALL/DU_BLOCK_SIZE imports",
      "authorFixture": "Author source helper uses abc and 12345, like original native tree; size-N is a dense zero Uint8Array(N).",
      "independentFixtureDelta": "Independent probe uses 3 and 5 zero bytes instead of abc/12345. This is a content-input delta, not unchanged-byte evidence. Both original author and independent product status/stdout/stderr records are byte-equal for every one of the 87 cases. These DU cases use metadata only.",
      "allocation": "Memory allocation is unknown. Every one of these 15 differing cases requests apparent mode (-b or --apparent-size), so missing allocation is NOT a cause of these differences."
    }
  },
  "new": {
    "native": {
      "provider": "Host filesystem, same physical fixture used by RealFileSystem",
      "cwd": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/independent/evidence/review-MduamP/fixture-GCyNoB",
      "environment": {
        "PATH": "/usr/bin:/bin",
        "LC_ALL": "C"
      }
    },
    "du": {
      "provider": "createRealFileSystem({root: native cwd}) via actual Shell and built DU plugin",
      "cwd": "/",
      "contextEnvironment": {
        "PWD": "/"
      }
    },
    "fixtureCreationOrder": [
      "mkdir tree/sub/deep recursively",
      "write tree/a: 3 zero bytes",
      "write tree/sub/b: 1025 zero bytes",
      "write tree/sub/deep/c: 511 zero bytes",
      "hardlink tree/a -> alias",
      "symlink link -> tree",
      "symlink broken -> missing",
      "symlink tree/sub/cycle -> ../..",
      "empty sparse then truncate to 4194305",
      "write -dash: 7 zero bytes",
      "write size-N dense zero files in listed order"
    ],
    "sizes": [
      0,
      1,
      511,
      512,
      513,
      999,
      1000,
      1001,
      1023,
      1024,
      1025,
      9217,
      10239,
      10240,
      1047552,
      1047553,
      1048575,
      1048576,
      1048577
    ],
    "scope": "All three cases have one operand tree. alias, link, broken, sparse, -dash, and size-N are outside that operand. alias changes tree/a nlink but is not separately visited. cycle is a final symlink, not followed. No fixture content changes occur between the 115 cases and the mapped-root assertion."
  }
}
```

## Complete 18-case inventory with unmodified raw outputs

Oxxx is the 1-based index in original results[ ]; the original named ID is retained verbatim, including the trailing space in "-b ". Nxxx is a report-local 1-based index in nativeIndependent[ ]; that capture has no separate named ID. JSON strings preserve tabs, LF and NUL as escapes. Each record includes full argv, native environment, actual DU context environment, cwd/provider/fixture reference, original raw JSON pointers, status, stdout and stderr for both implementations.

### O052 — "tree:-s -d0" (G1)

```json
{
  "id": "O052",
  "cohort": "original-87",
  "caseIndexOneBased": 52,
  "originalCaseId": "tree:-s -d0",
  "group": "G1",
  "argv": [
    "-b",
    "-s",
    "-d0",
    "tree"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/51",
    "canonical": "tests/commands/du/native-profile.json#/results/51",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/51",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/51"
  },
  "native": {
    "status": 0,
    "stdout": "8\ttree\n",
    "stderr": "du: warning: summarizing is the same as using --max-depth=0\n"
  },
  "du": {
    "status": 0,
    "stdout": "8\ttree\n",
    "stderr": ""
  }
}
```

### O053 — "tree:-as" (G2)

```json
{
  "id": "O053",
  "cohort": "original-87",
  "caseIndexOneBased": 53,
  "originalCaseId": "tree:-as",
  "group": "G2",
  "argv": [
    "-b",
    "-as",
    "tree"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/52",
    "canonical": "tests/commands/du/native-profile.json#/results/52",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/52",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/52"
  },
  "native": {
    "status": 1,
    "stdout": "",
    "stderr": "du: cannot both summarize and show all entries\nTry '/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du --help' for more information.\n"
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: cannot combine --all and --summarize\n"
  }
}
```

### O054 — "tree:-s -d1" (G2)

```json
{
  "id": "O054",
  "cohort": "original-87",
  "caseIndexOneBased": 54,
  "originalCaseId": "tree:-s -d1",
  "group": "G2",
  "argv": [
    "-b",
    "-s",
    "-d1",
    "tree"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/53",
    "canonical": "tests/commands/du/native-profile.json#/results/53",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/53",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/53"
  },
  "native": {
    "status": 1,
    "stdout": "",
    "stderr": "du: warning: summarizing conflicts with --max-depth=1\nTry '/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du --help' for more information.\n"
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: --summarize conflicts with --max-depth\n"
  }
}
```

### O060 — "-b tree tree" (G6)

```json
{
  "id": "O060",
  "cohort": "original-87",
  "caseIndexOneBased": 60,
  "originalCaseId": "-b tree tree",
  "group": "G6",
  "argv": [
    "-b",
    "tree",
    "tree"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/59",
    "canonical": "tests/commands/du/native-profile.json#/results/59",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/59",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/59"
  },
  "native": {
    "status": 0,
    "stdout": "5\ttree/sub\n8\ttree\n",
    "stderr": ""
  },
  "du": {
    "status": 0,
    "stdout": "5\ttree/sub\n8\ttree\n0\ttree/sub\n0\ttree\n",
    "stderr": ""
  }
}
```

### O061 — "-b missing tree/a" (G3)

```json
{
  "id": "O061",
  "cohort": "original-87",
  "caseIndexOneBased": 61,
  "originalCaseId": "-b missing tree/a",
  "group": "G3",
  "argv": [
    "-b",
    "missing",
    "tree/a"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/60",
    "canonical": "tests/commands/du/native-profile.json#/results/60",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/60",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/60"
  },
  "native": {
    "status": 1,
    "stdout": "3\ttree/a\n",
    "stderr": "du: cannot access 'missing': No such file or directory\n"
  },
  "du": {
    "status": 1,
    "stdout": "3\ttree/a\n",
    "stderr": "du: \"missing\": no such file or directory, lstat '/missing'\n"
  }
}
```

### O062 — "-b " (G3)

```json
{
  "id": "O062",
  "cohort": "original-87",
  "caseIndexOneBased": 62,
  "originalCaseId": "-b ",
  "group": "G3",
  "argv": [
    "-b",
    ""
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/61",
    "canonical": "tests/commands/du/native-profile.json#/results/61",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/61",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/61"
  },
  "native": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid zero-length file name\n"
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: \"\": no such file or directory, lstat ''\n"
  }
}
```

### O063 — "-b tree/a --unsupported" (G2)

```json
{
  "id": "O063",
  "cohort": "original-87",
  "caseIndexOneBased": 63,
  "originalCaseId": "-b tree/a --unsupported",
  "group": "G2",
  "argv": [
    "-b",
    "tree/a",
    "--unsupported"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/62",
    "canonical": "tests/commands/du/native-profile.json#/results/62",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/62",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/62"
  },
  "native": {
    "status": 1,
    "stdout": "",
    "stderr": "/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du: unrecognized option '--unsupported'\nTry '/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du --help' for more information.\n"
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: unrecognized option '--unsupported'\n"
  }
}
```

### O073 — "block:b" (G4)

```json
{
  "id": "O073",
  "cohort": "original-87",
  "caseIndexOneBased": 73,
  "originalCaseId": "block:b",
  "group": "G4",
  "argv": [
    "-b",
    "-B",
    "b",
    "size-1025"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/72",
    "canonical": "tests/commands/du/native-profile.json#/results/72",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/72",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/72"
  },
  "native": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid -B argument 'b'\n"
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid block size 'b'\n"
  }
}
```

### O074 — "block:0" (G4)

```json
{
  "id": "O074",
  "cohort": "original-87",
  "caseIndexOneBased": 74,
  "originalCaseId": "block:0",
  "group": "G4",
  "argv": [
    "-b",
    "-B",
    "0",
    "size-1025"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/73",
    "canonical": "tests/commands/du/native-profile.json#/results/73",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/73",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/73"
  },
  "native": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid -B argument '0'\n"
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid or unsafe block size '0'\n"
  }
}
```

### O075 — "block:-1" (G4)

```json
{
  "id": "O075",
  "cohort": "original-87",
  "caseIndexOneBased": 75,
  "originalCaseId": "block:-1",
  "group": "G4",
  "argv": [
    "-b",
    "-B",
    "-1",
    "size-1025"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/74",
    "canonical": "tests/commands/du/native-profile.json#/results/74",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/74",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/74"
  },
  "native": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid -B argument '-1'\n"
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid block size '-1'\n"
  }
}
```

### O076 — "block:1.5K" (G4)

```json
{
  "id": "O076",
  "cohort": "original-87",
  "caseIndexOneBased": 76,
  "originalCaseId": "block:1.5K",
  "group": "G4",
  "argv": [
    "-b",
    "-B",
    "1.5K",
    "size-1025"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/75",
    "canonical": "tests/commands/du/native-profile.json#/results/75",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/75",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/75"
  },
  "native": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid suffix in -B argument '1.5K'\n"
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid block size '1.5K'\n"
  }
}
```

### O079 — "block:Q" (G4)

```json
{
  "id": "O079",
  "cohort": "original-87",
  "caseIndexOneBased": 79,
  "originalCaseId": "block:Q",
  "group": "G4",
  "argv": [
    "-b",
    "-B",
    "Q",
    "size-1025"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/78",
    "canonical": "tests/commands/du/native-profile.json#/results/78",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/78",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/78"
  },
  "native": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid -B argument 'Q'\n"
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid or unsafe block size 'Q'\n"
  }
}
```

### O080 — "block:1Q" (G4)

```json
{
  "id": "O080",
  "cohort": "original-87",
  "caseIndexOneBased": 80,
  "originalCaseId": "block:1Q",
  "group": "G4",
  "argv": [
    "-b",
    "-B",
    "1Q",
    "size-1025"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/79",
    "canonical": "tests/commands/du/native-profile.json#/results/79",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/79",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/79"
  },
  "native": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid suffix in -B argument '1Q'\n"
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid or unsafe block size '1Q'\n"
  }
}
```

### O086 — "env:{\"DU_BLOCK_SIZE\":\"bad\"}" (G5)

```json
{
  "id": "O086",
  "cohort": "original-87",
  "caseIndexOneBased": 86,
  "originalCaseId": "env:{\"DU_BLOCK_SIZE\":\"bad\"}",
  "group": "G5",
  "argv": [
    "--apparent-size",
    "size-1025"
  ],
  "caseEnvironment": {
    "DU_BLOCK_SIZE": "bad"
  },
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C",
    "DU_BLOCK_SIZE": "bad"
  },
  "duContextEnvironment": {
    "DU_BLOCK_SIZE": "bad",
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/85",
    "canonical": "tests/commands/du/native-profile.json#/results/85",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/85",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/85"
  },
  "native": {
    "status": 0,
    "stdout": "2\tsize-1025\n",
    "stderr": ""
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid block size 'bad'\n"
  }
}
```

### O087 — "env:{\"DU_BLOCK_SIZE\":\"\",\"BLOCK_SIZE\":\"2K\"}" (G5)

```json
{
  "id": "O087",
  "cohort": "original-87",
  "caseIndexOneBased": 87,
  "originalCaseId": "env:{\"DU_BLOCK_SIZE\":\"\",\"BLOCK_SIZE\":\"2K\"}",
  "group": "G5",
  "argv": [
    "--apparent-size",
    "size-1025"
  ],
  "caseEnvironment": {
    "DU_BLOCK_SIZE": "",
    "BLOCK_SIZE": "2K"
  },
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C",
    "DU_BLOCK_SIZE": "",
    "BLOCK_SIZE": "2K"
  },
  "duContextEnvironment": {
    "DU_BLOCK_SIZE": "",
    "BLOCK_SIZE": "2K",
    "PWD": "/"
  },
  "nativeCwdExact": null,
  "nativeCwdKnownPattern": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/evidence/native-P1ILRO/fixture-<random suffix not recorded>",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.original",
  "rawReferences": {
    "original": "tests/commands/du/evidence/native-P1ILRO/profile.json#/results/86",
    "canonical": "tests/commands/du/native-profile.json#/results/86",
    "author": "tests/commands/du/evidence/comparison-zAVfBj/results.json#/memoryResults/86",
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeProfile/86"
  },
  "native": {
    "status": 0,
    "stdout": "2\tsize-1025\n",
    "stderr": ""
  },
  "du": {
    "status": 1,
    "stdout": "",
    "stderr": "du: invalid block size ''\n"
  }
}
```

### N002 — ["-a","tree"] (G7)

```json
{
  "id": "N002",
  "cohort": "new-115",
  "caseIndexOneBased": 2,
  "originalCaseId": null,
  "caseIdQualification": "Original new-115 capture has argv and array position, not a named case ID. Nxxx is a report-local 1-based identifier.",
  "group": "G7",
  "argv": [
    "-a",
    "tree"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/independent/evidence/review-MduamP/fixture-GCyNoB",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.new",
  "rawReferences": {
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeIndependent/1"
  },
  "native": {
    "status": 0,
    "stdout": "4\ttree/a\n0\ttree/sub/cycle\n4\ttree/sub/deep/c\n4\ttree/sub/deep\n4\ttree/sub/b\n8\ttree/sub\n12\ttree\n",
    "stderr": ""
  },
  "du": {
    "status": 0,
    "stdout": "4\ttree/a\n4\ttree/sub/b\n0\ttree/sub/cycle\n4\ttree/sub/deep/c\n4\ttree/sub/deep\n8\ttree/sub\n12\ttree\n",
    "stderr": ""
  },
  "exactAllFields": false,
  "sameRecordMultisetStatusStderr": true
}
```

### N014 — ["-ac0B512","tree"] (G7)

```json
{
  "id": "N014",
  "cohort": "new-115",
  "caseIndexOneBased": 14,
  "originalCaseId": null,
  "caseIdQualification": "Original new-115 capture has argv and array position, not a named case ID. Nxxx is a report-local 1-based identifier.",
  "group": "G7",
  "argv": [
    "-ac0B512",
    "tree"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/independent/evidence/review-MduamP/fixture-GCyNoB",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.new",
  "rawReferences": {
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeIndependent/13"
  },
  "native": {
    "status": 0,
    "stdout": "8\ttree/a\u00000\ttree/sub/cycle\u00008\ttree/sub/deep/c\u00008\ttree/sub/deep\u00008\ttree/sub/b\u000016\ttree/sub\u000024\ttree\u000024\ttotal\u0000",
    "stderr": ""
  },
  "du": {
    "status": 0,
    "stdout": "8\ttree/a\u00008\ttree/sub/b\u00000\ttree/sub/cycle\u00008\ttree/sub/deep/c\u00008\ttree/sub/deep\u000016\ttree/sub\u000024\ttree\u000024\ttotal\u0000",
    "stderr": ""
  },
  "exactAllFields": false,
  "sameRecordMultisetStatusStderr": true
}
```

### N017 — ["--all","--total","--null","--block-size=1","tree"] (G7)

```json
{
  "id": "N017",
  "cohort": "new-115",
  "caseIndexOneBased": 17,
  "originalCaseId": null,
  "caseIdQualification": "Original new-115 capture has argv and array position, not a named case ID. Nxxx is a report-local 1-based identifier.",
  "group": "G7",
  "argv": [
    "--all",
    "--total",
    "--null",
    "--block-size=1",
    "tree"
  ],
  "caseEnvironment": {},
  "nativeEnvironment": {
    "PATH": "/usr/bin:/bin",
    "LC_ALL": "C"
  },
  "duContextEnvironment": {
    "PWD": "/"
  },
  "nativeCwdExact": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/independent/evidence/review-MduamP/fixture-GCyNoB",
  "duCwd": "/",
  "providerAndFixtureRef": "contexts.new",
  "rawReferences": {
    "independent": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/nativeIndependent/16"
  },
  "native": {
    "status": 0,
    "stdout": "4096\ttree/a\u00000\ttree/sub/cycle\u00004096\ttree/sub/deep/c\u00004096\ttree/sub/deep\u00004096\ttree/sub/b\u00008192\ttree/sub\u000012288\ttree\u000012288\ttotal\u0000",
    "stderr": ""
  },
  "du": {
    "status": 0,
    "stdout": "4096\ttree/a\u00004096\ttree/sub/b\u00000\ttree/sub/cycle\u00004096\ttree/sub/deep/c\u00004096\ttree/sub/deep\u00008192\ttree/sub\u000012288\ttree\u000012288\ttotal\u0000",
    "stderr": ""
  },
  "exactAllFields": false,
  "sameRecordMultisetStatusStderr": true
}
```

## Exact ordering mechanics, multiplicities, and comparator limitations

Under tree/sub, creation order was deep, b, cycle. Effective frozen native order is cycle, deep, b; Node readdir and DU order are b, cycle, deep. The names are ASCII: b starts at byte/code unit 0x62, cycle at 0x63, deep at 0x64. UTF-8 byte order and UTF-16 code-unit order agree here. It is neither a Unicode locale issue nor an operand-order change: all three commands have the single operand tree. The C locale does not ask FTS to sort directory entries.

Both streams preserve postorder directory totals; -c appends total last. Only the position of b relative to cycle and the deep subtree changes. This has observable effects for consumers such as head and is not exact stream parity even though all accounting is equal. Native small-directory FTS uses directory enumeration; its large-directory inode-order optimization (threshold 10000) is not applicable to three children. The new corroboration shows Node opendir yields native order but Node readdir yields lexical order, which RealFileSystem currently forwards. Removing the DU sort alone therefore cannot reproduce these native bytes on this host.

The comparison sorts arrays of complete record strings, not sets. It PRESERVES duplicate records, size/path associations, the trailing empty delimiter element, separately exact stderr, and separately exact status. It discards only record order for these safe ASCII paths. Original O060 still has extra zero rows and would not become equal under this multiset comparison. The older author 18-case helper used trimEnd before LF splitting; that is NOT the new-115 comparator.

```json
{
  "names": {
    "b": {
      "utf8Hex": "62",
      "utf16": [
        98
      ]
    },
    "cycle": {
      "utf8Hex": "6379636c65",
      "utf16": [
        99,
        121,
        99,
        108,
        101
      ]
    },
    "deep": {
      "utf8Hex": "64656570",
      "utf16": [
        100,
        101,
        101,
        112
      ]
    }
  },
  "creationOrderUnderTreeSub": [
    "deep",
    "b",
    "cycle"
  ],
  "frozenNativeVisitOrderUnderTreeSub": [
    "cycle",
    "deep",
    "b"
  ],
  "duVisitOrderUnderTreeSub": [
    "b",
    "cycle",
    "deep"
  ],
  "nativeRecords": [
    "tree/a",
    "tree/sub/cycle",
    "tree/sub/deep/c",
    "tree/sub/deep",
    "tree/sub/b",
    "tree/sub",
    "tree"
  ],
  "duRecords": [
    "tree/a",
    "tree/sub/b",
    "tree/sub/cycle",
    "tree/sub/deep/c",
    "tree/sub/deep",
    "tree/sub",
    "tree"
  ],
  "totals": "N014/N017 append total last in both streams. All three retain directory postorder. Each has one operand tree, so these are not operand-order changes. LC_ALL=C does not imply sorted enumeration. With these ASCII names UTF-8 byte order and UTF-16 code-unit order agree; this is not a Unicode collation difference.",
  "accounting": "The same rows bind the same values to the same paths. N002 uses 1024-byte blocks; N014 uses 512-byte blocks; N017 uses bytes. The three file allocations are 4096 bytes each, as seen in N017. The cycle symlink contributes 0 allocated bytes and is not followed. Subtree sums and grand totals match. Raw output implies zero directory-own contribution on this fixture; separate raw stat objects were not recorded.",
  "comparator": {
    "source": "value.split(nul ? \"\\0\" : \"\\n\").sort(); status and stderr compared separately with ===",
    "duplicatePolicy": "Array.sort does not remove duplicate strings. Identical repeated rows remain repeated; no Set, unique operation, or path-only map is used. Trailing empty split element remains, so terminator/row-count differences remain detectable for these names.",
    "preserved": "Complete formatted record including size and literal path; multiplicity; status; byte-equal decoded stderr; delimiter choice for these cases.",
    "notPreserved": "stdout sequence, the tested notion of exact stream order. It can hide downstream first/last-record differences, and is not exact native output acceptance.",
    "scope": "All native ordering names are ASCII without LF/TAB/NUL; no invalid-UTF8 or LF-in-name claim. The product-only separate NUL-name test is not one of these native three. The new comparator does not trimEnd, unlike the older separate author 18-case normalization helper."
  },
  "nativeReplay": "The original syscall enumeration was not logged. Three new, same-recipe native-only replays plus node opendir/readdir inspection corroborate the source-level explanation and exactly reproduce the frozen native stdout/stderr/status. They do not reconstruct original inodes/timestamps or replace frozen evidence."
}
```

## Three bounded native-only corroborations

These are new fixture instances with new path/inodes/timestamps, not a replay over the deleted original directory. The complete creation recipe and logical inputs are retained; only N002/N014/N017 were executed. All three exactly reproduced their frozen native stdout/stderr/status. No new DU execution was necessary for classifying the authenticated frozen outputs.

```json
{
  "profile": "bounded three-case native-only corroboration; new temporary fixture, not replacement of frozen outputs",
  "fixture": "/tmp/du-native-difference-classification-4ijivX/fixture-UB4YZ2",
  "entries": {
    "tree": {
      "nodeReaddir": [
        "a",
        "sub"
      ],
      "nodeOpendirIteration": [
        "a",
        "sub"
      ],
      "codeUnits": [
        {
          "name": "a",
          "utf8Hex": "61",
          "utf16CodeUnits": [
            97
          ]
        },
        {
          "name": "sub",
          "utf8Hex": "737562",
          "utf16CodeUnits": [
            115,
            117,
            98
          ]
        }
      ]
    },
    "tree/sub": {
      "nodeReaddir": [
        "b",
        "cycle",
        "deep"
      ],
      "nodeOpendirIteration": [
        "cycle",
        "deep",
        "b"
      ],
      "codeUnits": [
        {
          "name": "cycle",
          "utf8Hex": "6379636c65",
          "utf16CodeUnits": [
            99,
            121,
            99,
            108,
            101
          ]
        },
        {
          "name": "deep",
          "utf8Hex": "64656570",
          "utf16CodeUnits": [
            100,
            101,
            101,
            112
          ]
        },
        {
          "name": "b",
          "utf8Hex": "62",
          "utf16CodeUnits": [
            98
          ]
        }
      ]
    },
    "tree/sub/deep": {
      "nodeReaddir": [
        "c"
      ],
      "nodeOpendirIteration": [
        "c"
      ],
      "codeUnits": [
        {
          "name": "c",
          "utf8Hex": "63",
          "utf16CodeUnits": [
            99
          ]
        }
      ]
    }
  },
  "cases": [
    {
      "caseIndex": 2,
      "args": [
        "-a",
        "tree"
      ],
      "env": {
        "PATH": "/usr/bin:/bin",
        "LC_ALL": "C"
      },
      "native": {
        "status": 0,
        "stdout": "4\ttree/a\n0\ttree/sub/cycle\n4\ttree/sub/deep/c\n4\ttree/sub/deep\n4\ttree/sub/b\n8\ttree/sub\n12\ttree\n",
        "stderr": ""
      },
      "exactFrozenNative": true
    },
    {
      "caseIndex": 14,
      "args": [
        "-ac0B512",
        "tree"
      ],
      "env": {
        "PATH": "/usr/bin:/bin",
        "LC_ALL": "C"
      },
      "native": {
        "status": 0,
        "stdout": "8\ttree/a\u00000\ttree/sub/cycle\u00008\ttree/sub/deep/c\u00008\ttree/sub/deep\u00008\ttree/sub/b\u000016\ttree/sub\u000024\ttree\u000024\ttotal\u0000",
        "stderr": ""
      },
      "exactFrozenNative": true
    },
    {
      "caseIndex": 17,
      "args": [
        "--all",
        "--total",
        "--null",
        "--block-size=1",
        "tree"
      ],
      "env": {
        "PATH": "/usr/bin:/bin",
        "LC_ALL": "C"
      },
      "native": {
        "status": 0,
        "stdout": "4096\ttree/a\u00000\ttree/sub/cycle\u00004096\ttree/sub/deep/c\u00004096\ttree/sub/deep\u00004096\ttree/sub/b\u00008192\ttree/sub\u000012288\ttree\u000012288\ttotal\u0000",
        "stderr": ""
      },
      "exactFrozenNative": true
    }
  ],
  "version": "du (GNU coreutils) 9.7\nCopyright (C) 2025 Free Software Foundation, Inc.\nLicense GPLv3+: GNU GPL version 3 or later <https://gnu.org/licenses/gpl.html>.\nThis is free software: you are free to change and redistribute it.\nThere is NO WARRANTY, to the extent permitted by law.\n\nWritten by Torbjorn Granlund, David MacKenzie, Paul Eggert,\nand Jim Meyering.\n",
  "fixtureCleaned": true
}
```

## Mapped-root profile delta, separate from the 18 differences

No fixture files were added, removed or rewritten for the historical mapped-root assertion. Its explicit input delta is native argv ["-bs", physicalFixture] versus DU argv ["-bs", "/"], with native cwd at the physical fixture and DU cwd at virtual /. This is a declared namespace/display mapping, not unchanged-argv proof. Native / would describe the host root; virtual / denotes the configured Real root. Both are valid different namespaces, not evidence that a DU command miscounts an otherwise identical input. No host-root traversal was run. Relative symlinks and fixture contents were not rewritten to force a match. Numeric 9474005, status 0 and empty stderr already matched; only the physical display prefix is replaced with /. This profile must not waive any of the 18 unmapped differences.

```json
{
  "countedAmong18": false,
  "rawReference": "tests/commands/du/independent/evidence/review-MduamP/independent.json#/rootMapping",
  "nativeArgv": [
    "-bs",
    "/Users/kjopek/Workspace/safe-bash/tests/commands/du/independent/evidence/review-MduamP/fixture-GCyNoB"
  ],
  "duArgv": [
    "-bs",
    "/"
  ],
  "nativeCwd": "/Users/kjopek/Workspace/safe-bash/tests/commands/du/independent/evidence/review-MduamP/fixture-GCyNoB",
  "duCwd": "/",
  "raw": {
    "native": {
      "status": 0,
      "stdout": "9474005\t/Users/kjopek/Workspace/safe-bash/tests/commands/du/independent/evidence/review-MduamP/fixture-GCyNoB\n",
      "stderr": ""
    },
    "product": {
      "status": 0,
      "stdout": "9474005\t/\n",
      "stderr": ""
    },
    "transformation": "replace owned native fixture absolute path with virtual /"
  },
  "inputDelta": "Explicit argv/namespace mapping: native absolute task-fixture path versus virtual /. This is not unchanged-argv parity. The helper does NOT change fixture files between the 115 cases and this root check.",
  "namespace": "RealFileSystem binds virtual / to the configured physical fixture root. Native / would mean the whole host filesystem, not that fixture; both spellings can be valid in different namespaces and need not have equal totals. No native host-root run was made or used. Earlier -bs . and -bs ./ cases use the same fixture and valid relative spellings, not invalid inputs corrected to make a test pass.",
  "comparison": "The sole transformation replaces the exact owned physical-root display prefix with /. The numeric 9474005, status 0 and empty stderr already match. Relative symlinks link->tree, broken->missing and cycle->../.. are left unchanged and stay inside or missing relative to the configured fixture namespace.",
  "conclusion": "A declared namespace-mapping profile, not a repair of a command defect and not permission to waive differences in the 18 unchanged original/new cases."
}
```

## Authentication and read-only preservation

The original native profile is byte-identical to canonical native-profile.json and its committed f2d6f710 blob; all 87 original native records and all author Memory product results equal their independent counterparts. All 257 frozen input hashes were verified against Git objects from 877144ea; rebuilding the same archive bytes in memory reproduced the recorded archive hash. All 55 author-sealed files and all 244 independent committed files were verified and rechecked. The ten source files read for explanations equal the frozen commit. GNU binary realpath/version/hash and du.c hash match original evidence before/after. Local supplemental primary source hashes are included, with their reproducible-build limitation stated.

```json
{
  "sourceCommit": "877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3",
  "authorCommit": "f2d6f710d9e0b9481957ff302bba90a0f11c9bad",
  "reviewCommit": "19cc7e8c3567b521e04159010efe32da5673b5b4",
  "observedLiveHeadAtAuthentication": "27a7793526830768484885afba5832bf8bb248b5",
  "captureHashes": {
    "tests/commands/du/evidence/native-P1ILRO/profile.json": "f3c76252370ed72020de8ae6ede90093b0bdb098047c359f2deb088b4e4f8653",
    "tests/commands/du/native-profile.json": "f3c76252370ed72020de8ae6ede90093b0bdb098047c359f2deb088b4e4f8653",
    "tests/commands/du/evidence/comparison-zAVfBj/results.json": "8f9a3feef4a8e3d4070d737f7089d4e4c7e176de5cf16a8ecb9c3a5219c852aa",
    "tests/commands/du/independent/evidence/review-MduamP/independent.json": "aae689ff0b3316f35663122ac3d7e1c1a43686644f082967168ca8b893907c5b",
    "tests/commands/du/independent/evidence/review-MduamP/manifest.json": "41f48affa3a297893cdb04b523272379cd061a227413a843e9b975efc6657989",
    "tests/commands/du/independent/evidence/review-MduamP/built-files.json": "0aa6f31e650a9d3ab6314787abd5b55a02d3fe4b85ee31497c23b0f8adef8857",
    "tests/commands/du/evidence/SHA256.json": "59f8effd98cc7fef00c44ff536bf39bd3e87e3d156a35642de1c71368fe62d79"
  },
  "archiveSha256": "c8f214b3fec6aac5ea55e9ffdcc196c5590ea4eb8a16ba001241cf1f1b447432",
  "authenticatedFrozenGitInputs": 257,
  "currentSourceAudit": {
    "src/commands/du/arguments.ts": {
      "committedSha256": "a777c2575100dbe305dd7376b525727cc213039eda90b659d323841ed05bf041",
      "currentSha256": "a777c2575100dbe305dd7376b525727cc213039eda90b659d323841ed05bf041"
    },
    "src/commands/du/format.ts": {
      "committedSha256": "84463e68db86ca767b05b410c79c0844e97be2c3585ed7fff2f81ae15411daa1",
      "currentSha256": "84463e68db86ca767b05b410c79c0844e97be2c3585ed7fff2f81ae15411daa1"
    },
    "src/commands/du/du.ts": {
      "committedSha256": "6954f5f86f69ec9aca39f464198d200b0895b6b286df9a5bd08c44444f9b8ca2",
      "currentSha256": "6954f5f86f69ec9aca39f464198d200b0895b6b286df9a5bd08c44444f9b8ca2"
    },
    "src/commands/du/budget.ts": {
      "committedSha256": "b97e9e9b9a02fae0c95fe9f50af79644bab053d6426fb8b2886a413160c29971",
      "currentSha256": "b97e9e9b9a02fae0c95fe9f50af79644bab053d6426fb8b2886a413160c29971"
    },
    "src/fs/real/index.ts": {
      "committedSha256": "ab139aa429c2705c7d5ec13a20d1583bacb182e3e2347fcdee2f169704c0bc9a",
      "currentSha256": "ab139aa429c2705c7d5ec13a20d1583bacb182e3e2347fcdee2f169704c0bc9a"
    },
    "src/shell/shell.ts": {
      "committedSha256": "538f7ea1504019fcde03abc2781c1f903573243a0332033b87501804a1c4ac5c",
      "currentSha256": "538f7ea1504019fcde03abc2781c1f903573243a0332033b87501804a1c4ac5c"
    },
    "src/shell/runtime.ts": {
      "committedSha256": "4e937b71df3135d1262a616924b4173e982f236dd86415e0e75895eac9c85e06",
      "currentSha256": "4e937b71df3135d1262a616924b4173e982f236dd86415e0e75895eac9c85e06"
    },
    "tests/commands/du/helpers.ts": {
      "committedSha256": "0d721aeb1a602794f22dca7874cad1f64efab21db27df022b7499e9e31d4f802",
      "currentSha256": "0d721aeb1a602794f22dca7874cad1f64efab21db27df022b7499e9e31d4f802"
    },
    "tests/commands/du/capture-native.mjs": {
      "committedSha256": "c687b8de8a1e655697322c803af93dc799b250191f7543d2120543d7faf68794",
      "currentSha256": "c687b8de8a1e655697322c803af93dc799b250191f7543d2120543d7faf68794"
    },
    "tests/commands/du/capture-comparison.mjs": {
      "committedSha256": "9bd08d6b8a3c05e02125ad8e8e0fcf418b48c7c0735724ff22d18bc075d28048",
      "currentSha256": "9bd08d6b8a3c05e02125ad8e8e0fcf418b48c7c0735724ff22d18bc075d28048"
    }
  },
  "authorSealedFilesVerified": 55,
  "independentCommittedFilesVerified": 244,
  "oracle": {
    "actualPath": "/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du",
    "versionFirstLine": "du (GNU coreutils) 9.7",
    "binarySha256": "f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b",
    "duCSourceSha256": "3cd1c0120881ba28da3345b1324e9d146f948a95db6ce2900ba27b3fe8f45bf9"
  },
  "supplementalLocalPrimarySourceHashes": {
    "lib/human.c": "f2ba7b4b1678020886afa66944d7e7cb106a60d46cea01e37e02cdbddfd78ad7",
    "lib/fts.c": "fcc8f37fa526afbc248d11e205290655f16cb461d43d142c158cc7f519c5b1df",
    "lib/xfts.c": "b47b1263c125bc4d6c42a13914137ba524b2fb55bdb112fa96e6c48001b2470e",
    "lib/xstrtol.c": "0c3d503d35a4a7c14df51fe8a290c05f13793bc4a1adb34364823853101931e8",
    "lib/config.h": "cb3b7a64faca1cd9b6d1683aa636e98da83a0546b2b663c7c5c9b7d3dfeedc4a",
    "doc/coreutils.texi": "39b126752866fff675e462bd44d76f3e034abafe462a069cebd53ef39fc53eca"
  },
  "supplementalQualification": "Local pinned build-tree sources inspected read-only. nm confirms this binary contains rpl_fts_open/rpl_fts_read, human_options and an external readdir reference. Supplemental source hashes are newly recorded; they are not an independent reproducible-build attestation of all linked objects.",
  "recordedLoadedDuModuleSha256": "022198ae78b24958ce290ce53a7cfb86e19c05b1f04b4094566e36838daf3c4f",
  "recordedLoadedModuleQualification": "Historical isolated dist was cleaned. Its recorded hash and build inventory are authenticated through committed evidence; no fresh product build or execution was performed in this read-only classification."
}
```

Source pointers (relative to the repository; GNU pointers are pinned local primary source):

```json
{
  "duArguments": "src/commands/du/arguments.ts:82",
  "duFormat": "src/commands/du/format.ts:9",
  "duIdentity": "src/commands/du/du.ts:15",
  "duSort": "src/commands/du/du.ts:68",
  "duEmptyOperand": "src/commands/du/du.ts:82",
  "duOperandOrder": "src/commands/du/du.ts:119",
  "realEnumeration": "src/fs/real/index.ts:286",
  "shellContext": "src/shell/shell.ts:136",
  "shellExportedContext": "src/shell/runtime.ts:798",
  "gnuDuplicate": "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du.c:529",
  "gnuHashAll": "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du.c:1026",
  "gnuTraversal": "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du.c:663",
  "gnuEnvironment": "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du.c:735",
  "gnuBlockParser": "tests/commands/metadata-stress/.oracle/coreutils-9.7/lib/human.c:414",
  "gnuBlockDefault": "tests/commands/metadata-stress/.oracle/coreutils-9.7/lib/human.c:464",
  "gnuEnumeration": "tests/commands/metadata-stress/.oracle/coreutils-9.7/lib/fts.c:1444",
  "gnuEnumerationAppend": "tests/commands/metadata-stress/.oracle/coreutils-9.7/lib/fts.c:1555",
  "gnuInodeSortThreshold": "tests/commands/metadata-stress/.oracle/coreutils-9.7/lib/fts.c:151",
  "gnuManual": "tests/commands/metadata-stress/.oracle/coreutils-9.7/doc/coreutils.texi:12571",
  "recordComparison": "tests/commands/du/independent/probe.mjs:32"
}
```

Preservation/cleanup audit:

```json
{
  "allReadArtifactsUnchanged": true,
  "checkedOriginalPathsOnly": true,
  "appendProof": false,
  "repositoryWrites": 0,
  "stagingCommands": 0,
  "commitCommands": 0,
  "productionBuilds": 0,
  "productExecutions": 0,
  "nativeMeasurementExecutions": 3,
  "nativeVersionExecutions": 1,
  "nativeFixtureCleaned": true,
  "reportDirectoryIntentionallyRetained": "/tmp/du-native-difference-classification-4ijivX",
  "unrelatedConcurrentGitState": "Other owners staged/committed during review; those changes were neither altered nor used as frozen candidate inputs.",
  "headAfter": "b76613226767d0e79995b643ebfa278b6e932780",
  "indexBeforeSha256": "0996480dc8b842c5a41fc3f6f764332ba305d5deede44c8c0c3289c1ac5e9c48",
  "indexAfterSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

No policy change is approved here. This is not all-native-win, whole-repository, Linux, deployed-provider, or current-HEAD acceptance.
