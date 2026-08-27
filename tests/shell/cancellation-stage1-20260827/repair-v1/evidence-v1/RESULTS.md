# Stage 1 cancellation helper repair-v1 evidence

Regression freeze commit:
`01fbb3880bbe662adb2c7371e52ea3b47c0549f4`.

Source-only repair commit:
`fbbe1ef793b7434871403125efbeb46624a8e081`.

The original helper is candidate
`6747227230cd770379148552d471621717b766d7`, blob
`d5ceafef56a9351bd77630db66d9acfdc19a38ee`, SHA-256
`cde614b830e11f2040db65d2347c5f430df4b353324684585b2dc242ac733960`.
The repair helper is blob `a7742b7f7e81bcd8c1c2a6be35092d8b5f41102f`,
SHA-256 `ee048f6c38086dd40573db57e002e596029174ee2afc5f888e516779e5a718ac`.

The source diff is limited to two private paths. Notification stops only for a
closed boundary and skips individual inactive snapshot entries. Admission puts
the frame's already-observed delivered control ahead of still-aborted controls
listed in configured order. Root and invoke checks remain ahead of controls;
selection ranking, original origin objects, delivery reason, `Object.is`, and
falsy values are unchanged.

## Actual checks

- Frozen repair baseline against the old helper: 3/5 pass, R01/R03 fail, exit
  1, no retry. `../baseline.tap` is the raw capture.
- Focused repair runtime against the repair: 5/5 pass, exit 0, one run.
  `final-runtime.tap` is the raw capture.
- Unchanged original author runtime: 22/22 pass, exit 0, one run.
- Original author focused strict check: exit 0.
- Original four-row negative type fixture: exit 0.
- Original isolated helper build: exit 0. Emitted JS SHA-256
  `ef09ed467282c95ef729be71999b9945e7b16ddfaf90c1bc3d2688d30c138d13`;
  declaration SHA-256
  `67b90043f40ef0c5a53ae0be912351cb05f51707523ca4a3ae4e7d8b9f432e65`.

Node was `v22.22.2`; TypeScript was `5.9.3`. All commands exited naturally.
The isolated emitted files were enumerated, hashed, and then the exact owned
scratch tree was removed. No listener-owning process, scratch artifact, or
subagent remains from this repair.

## Limits and retained evidence

Locke's independent files were not edited or rerun. Their original exact 12-case
isolated and moved results remain 10/12, with the same P1/P2 failures; the six
type negatives and three mutants remain archived and untouched. This author
evidence is prepared for Locke replay after root handoff, not a replacement or
rescore. The original 38 author cases also remain unchanged.

No independent whole cohort, native oracle, Runtime/Shell/contracts/types,
timeout, first-read, export, package, configuration, or broad gate work ran.
Stage 2 remains unauthorized. Concurrent foreign working-tree and index entries
were not read into the checks, modified, unstaged, or committed.
