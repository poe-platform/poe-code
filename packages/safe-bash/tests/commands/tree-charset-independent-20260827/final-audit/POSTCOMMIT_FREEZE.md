# Post-commit freeze

This file freezes the already committed final report without claiming to
contain its own commit identity.

- Executed reconciliation commit:
  `b76613226767d0e79995b643ebfa278b6e932780`, tree
  `15e0c80e732a0fa2af356b111cfe4c16bfc94ea6`.
- Final README/result commit:
  `7a8e7bebc96156e511fc91389341d87e5aba317c`, tree
  `3de2b56d6a9b810f1087cf75a642b713317da19c`.
- Mutation-controls commit cross-audited:
  `2748e2abbc2dc838e02b1d75ee7d967f0749e8ad`, tree
  `2e0838b8e92ff88583e4e9651fe5a4549742ada6`.

The following SHA-256 values were computed after the report commit:

```text
76209f21a5c506ba8c40bea1ffac392cc16887cc5254f969b9cd02fc4191f991  README.md
fff3409c697de9731f0f356ac0acef0614c05bddb00932a0f5e224490dc2067f  RESULT.json
ce39bbc92ceecec438026aa7e8d94e94d6376c806bb4d7438353d9a550bc1c2c  harness/run.mjs
93e7667e367060142557fc526093481f17f29698436d398c37b741f41a0f5830  attempt-001/RESULT.json
902b7cebb186e80c85cd297c5aafaf94b5edff2ef10c0cb1086624c679f2c29a  attempt-001/SHA256SUMS
9cdda065aa05057a4d9fe7e51eebc503cf64c82811d7176d4f30f3cfa06f3903  attempt-001/inventory-reconciliation.json
4e925fa4424c2fbea85bd57db7e3a308a7855b722d9b6f293dfba4401cdbde40  attempt-001/package-authentication.json
3b8b350cb8eef3fc4d564b898ea3f0874b6e743783954ecdec0fbe47b389cf9b  attempt-001/source-authentication.json
b7faa0892568d6e5adfe8ddbac8d9c15eeb9edbd5f895b76c67415e8cf02b98c  attempt-001/tool-authentication.json
3572bac45f667bfbe23ed6d453e909498f0067047f994d7978edfb9f403a34cd  attempt-001/dist-manifest.json
a3f72715bd4109c9f17c48590d04bfccc60bf3b159200b78c6e566e4b75dae59  attempt-001/loaded-module-authentication.json
c77b5bb44882bca03adbcb6946864c40c8bf2443e3a2de901c4dcfbecc4ab23f  attempt-001/typecheck-authentication.json
```

The attempt manifest listed 67 files other than itself. A post-run completeness
check enumerated exactly 67 such files, found no unlisted additions, and
successfully verified every listed SHA-256.
