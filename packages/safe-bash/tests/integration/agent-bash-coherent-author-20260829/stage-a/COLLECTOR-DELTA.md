# Read-only collector v2

The first collector stopped, fully captured, when comparing a resolved target
under `/private/tmp/...` to a lexical `/tmp/...` expectation. No producer rerun.
The exact original comparison in publish-stop.mjs was:

`assert.equal(fs.realpathSync(filename),path.join(work,'tools',name,row.resolvedRelative));`

Version2 replaces only that comparison with:

`assert.equal(fs.realpathSync(filename),path.join(fs.realpathSync(path.join(work,'tools',name)),row.resolvedRelative));`

It also adds collectorQualification to the resulting report. The exact relative
target and each target hash remain pinned; this does not authorize a new tool
location, execute the links, alter retained files or repair the producer's
loader permission denial. Original publication error/capture remains unchanged.
