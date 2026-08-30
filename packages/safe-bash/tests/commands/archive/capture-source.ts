import { mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { withNative } from "./helpers.js";

await withNative(async (temporary, run) => {
  await mkdir(join(temporary, "input")); await mkdir(join(temporary, "input/sub")); await mkdir(join(temporary, "other"));
  await writeFile(join(temporary, "input/file"), "input"); await writeFile(join(temporary, "other/file"), "other");
  await mkdir(join(temporary, "other/child")); await symlink("../other/child", join(temporary, "input/alias"));
  run(["--format=ustar", "-cf", "parents.tar", "-C", "input/sub", "../file"]);
  console.log("parent listing", JSON.stringify(run(["-tf", "parents.tar"]).toString()));
  run(["--format=ustar", "-cf", "symlink-parent.tar", "-C", "input", "alias/../file"]);
  console.log("symlink-before-parent listing", JSON.stringify(run(["-tf", "symlink-parent.tar"]).toString()));
  console.log("symlink-before-parent payload", JSON.stringify(run(["-xOf", "symlink-parent.tar"]).toString()));
  run(["--format=ustar", "-cf", "directory.tar", "-C", "input/alias/..", "file"]);
  console.log("C symlink-before-parent payload", JSON.stringify(run(["-xOf", "directory.tar"]).toString()));
});
