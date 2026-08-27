# repair-v1 baseline

The focused repair suite ran once against the unchanged helper candidate
`6747227230cd770379148552d471621717b766d7`, blob
`d5ceafef56a9351bd77630db66d9acfdc19a38ee`, SHA-256
`cde614b830e11f2040db65d2347c5f430df4b353324684585b2dc242ac733960`.

Command (working directory `/Users/kjopek/Workspace/safe-bash`):

```text
node --import tsx --test tests/shell/cancellation-stage1-20260827/repair-v1/cancellation-repair.test.ts
```

Exit status: `1`. Exact result: 3 pass / 2 fail. Only R01 and R03 failed,
directly demonstrating P1 and P2. R02, R04, and R05 passed as preservation
controls. `baseline.tap` preserves the returned raw TAP bytes from this single
run; there was no retry. The focused strict TypeScript command below then exited
0 before freeze:

```text
./node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --types node --skipLibCheck src/shell/cancellation.ts tests/shell/cancellation-stage1-20260827/repair-v1/cancellation-repair.test.ts
```

No independent cohort, original author suite, native oracle, or broader gate ran
for this baseline. The historical independent 10/12 is retained without
rescore. Both Node processes settled naturally and no listener-owning process
remains.
