import path from "node:path";
import { own, frozen, repo, commits, overrides, git, hash, pack, write } from "./common.mjs";

function capture(commit, names) {
  const raw = git("cat-file", "commit", commit);
  const tree = raw.toString().match(/^tree (\w+)$/m)[1];
  const treeProof = {};
  const files = {};
  for (const name of names) {
    const parts = name.split("/");
    for (let count = 0; count < parts.length; count++) {
      const specifier = count === 0 ? `${commit}^{tree}` : `${commit}:${parts.slice(0, count).join("/")}`;
      const identifier = git("rev-parse", specifier).toString().trim();
      treeProof[identifier] = git("cat-file", "tree", identifier).toString("base64");
    }
    const bytes = git("show", `${commit}:${name}`);
    files[name] = { sha256: hash(bytes), base64: bytes.toString("base64"), blob: git("rev-parse", `${commit}:${name}`).toString().trim() };
  }
  return { commit: { sha: commit, base64: raw.toString("base64"), tree }, treeProof, files };
}
const prefix = path.relative(repo, frozen);
const names = ["DECLARED-CONTRACT.md", "MANIFEST.json", "PROTOCOL.md", "VALIDATION.json", "cases.mjs", "typed-inputs.ts", "validate.mjs"];
const freeze = capture(commits.freeze, names.map(name => `${prefix}/${name}`));
freeze.files = Object.fromEntries(Object.entries(freeze.files).map(([name, record]) => [name.slice(prefix.length + 1), record]));
write(path.join(own, "FROZEN-INPUTS.json.gz"), pack(freeze));
write(path.join(own, "CANDIDATE-PROOF.json.gz"), pack(capture(commits.candidate, Object.keys(overrides))));
