# Issue 2027: portable media command integration

- Reproduce the Node builtin deployment failure by bundling the media command
  for the browser without Node compatibility.
- Expose image codecs and pixel transforms through a portable image entry;
  use bundled pako compression for HEIF and explicit filesystem capabilities
  for composite file inputs. Preserve the Node Sharp API.
- Emit MP4 modules with TypeScript so command bundling shares the image engine
  instead of embedding a second engine copy.
- Align media package files and node:test runners with the workspace contract.
- Expose an explicit Safe Bash ffmpeg facade and portable private profile;
  preserve canonical contracts and leave default registration unchanged.
- Verify package admission and rewritten declaration/runtime edges in memfs,
  then execute isolated packed consumers in Node, browser and workerd profiles.
  Cover shell scripts, pipes, generation, PNG extraction and media budgets.
- Run maintained workspace checks, commit only issue changes, push to main,
  verify remote delivery and close the issue. Do not wait for publication.
