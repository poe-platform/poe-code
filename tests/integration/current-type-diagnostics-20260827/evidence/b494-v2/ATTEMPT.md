# Preserved second harness stop and tooling incident

No compiler or test executed in this attempt. Complete archived-file hashing
succeeded, including tab/newline names and literal symlinks. The tool census then
rejected a copied `.bin/esbuild` symlink. On this host `fs.cpSync` with
`dereference:true` had preserved source-pointing symlinks; an isolated two-file
control reproduced that behavior. The runner had already rewritten the copied
`.bin/tsc` launcher, which followed its symlink and changed the existing local
`node_modules/typescript/bin/tsc`. No product/config/fixture was changed, but this
was a real investigator tooling write outside the intended isolation.

It was immediately reported and restored with apply_patch to the exact bytes
from the existing npm cache's TypeScript5.9.3 tarball. The entire tarball SHA512
was checked against `package-lock.json`:

`sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==`

Restored launcher SHA256:
`8d5fa5bd883fec0979fc2004f1fe1d99aef40570155d550eadc0b03b55513bf0`.
Restored invocation reports `Version 5.9.3`. No installation/network was used.
There is no claim that unrelated concurrent tools could not have observed the
brief damaged launcher; this attempt establishes no candidate typing result.

The next runner explicitly reads each existing tool and writes a new exclusive
regular file, validates every resolved read target is within node_modules, checks
the entire copied tree contains no symlinks, and verifies the original launcher
hash after execution. The original START/FAILURE/CLEANUP and source census remain
unchanged here. Candidate source/config are never modified in any attempt.
