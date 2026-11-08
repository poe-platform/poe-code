# Exact frozen TypeScript diagnostics — 2026-08-27

Candidate `b494675c34dc289f4ad4b10a9201e1211eb0a7d8`. Cold: 30; post-build: 11.
No diagnostics were filtered from either captured compiler run.

| Path:line:column | Code | Post-build | Message |
| --- | --- | --- | --- |
| `tests/commands/file/text-bound.test.ts:67:72` | TS2749 | persists | 'TextEncoder' refers to a value, but is being used as a type here. Did you mean 'typeof TextEncoder'? |
| `tests/commands/file/text-bound.test.ts:79:72` | TS2749 | persists | 'TextEncoder' refers to a value, but is being used as a type here. Did you mean 'typeof TextEncoder'? |
| `tests/commands/file/text-bound.test.ts:136:72` | TS2749 | persists | 'TextEncoder' refers to a value, but is being used as a type here. Did you mean 'typeof TextEncoder'? |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__command.ts:1:33` | TS2307 | persists | Cannot find module './filesystem.js' or its corresponding type declarations. |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__command.ts:2:43` | TS2307 | persists | Cannot find module './io.js' or its corresponding type declarations. |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__filesystem.ts:1:33` | TS2307 | persists | Cannot find module './io.js' or its corresponding type declarations. |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__io.ts:2:25` | TS2307 | persists | Cannot find module './errors.js' or its corresponding type declarations. |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__path.ts:2:25` | TS2307 | persists | Cannot find module './errors.js' or its corresponding type declarations. |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__plugin.ts:1:106` | TS2307 | persists | Cannot find module './command.js' or its corresponding type declarations. |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__plugin.ts:2:40` | TS2307 | persists | Cannot find module './filesystem.js' or its corresponding type declarations. |
| `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__plugin.ts:31:17` | TS7006 | persists | Parameter 'context' implicitly has an 'any' type. |
| `tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts:6:8` | TS2307 | absent | Cannot find module 'virtual-bash' or its corresponding type declarations. |
| `tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts:7:91` | TS2307 | absent | Cannot find module 'virtual-bash/fs/webdav' or its corresponding type declarations. |
| `tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts:23:90` | TS7006 | absent | Parameter 'request' implicitly has an 'any' type. |
| `tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts:40:18` | TS18046 | absent | 'error' is of type 'unknown'. |
| `tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts:41:18` | TS18046 | absent | 'error' is of type 'unknown'. |
| `tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts:98:43` | TS7006 | absent | Parameter 'request' implicitly has an 'any' type. |
| `tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts:174:93` | TS7006 | absent | Parameter 'request' implicitly has an 'any' type. |
| `tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts:268:106` | TS7006 | absent | Parameter 'request' implicitly has an 'any' type. |
| `tests/integration/adapter-tools/atomic-webdav-profile/atomic-mock.ts:1:25` | TS2307 | absent | Cannot find module 'virtual-bash' or its corresponding type declarations. |
| `tests/integration/adapter-tools/atomic-webdav-profile/atomic-mock.ts:2:91` | TS2307 | absent | Cannot find module 'virtual-bash/fs/webdav' or its corresponding type declarations. |
| `tests/integration/adapter-tools/atomic-webdav-profile/atomic-mock.ts:25:59` | TS7006 | absent | Parameter 'segment' implicitly has an 'any' type. |
| `tests/integration/adapter-tools/atomic-webdav-profile/controls.ts:6:8` | TS2307 | absent | Cannot find module 'virtual-bash' or its corresponding type declarations. |
| `tests/integration/adapter-tools/atomic-webdav-profile/controls.ts:7:91` | TS2307 | absent | Cannot find module 'virtual-bash/fs/webdav' or its corresponding type declarations. |
| `tests/integration/adapter-tools/atomic-webdav-profile/controls.ts:21:94` | TS7006 | absent | Parameter 'request' implicitly has an 'any' type. |
| `tests/integration/adapter-tools/atomic-webdav-profile/controls.ts:32:18` | TS18046 | absent | 'reason' is of type 'unknown'. |
| `tests/integration/adapter-tools/atomic-webdav-profile/controls.ts:33:18` | TS18046 | absent | 'reason' is of type 'unknown'. |
| `tests/integration/adapter-tools/atomic-webdav-profile/controls.ts:104:92` | TS7006 | absent | Parameter 'request' implicitly has an 'any' type. |
| `tests/integration/adapter-tools/atomic-webdav-profile/controls.ts:120:104` | TS7006 | absent | Parameter 'request' implicitly has an 'any' type. |
| `tests/integration/adapter-tools/atomic-webdav-profile/controls.ts:188:100` | TS7006 | absent | Parameter 'request' implicitly has an 'any' type. |
