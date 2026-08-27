export interface NativeFixture {
  readonly name: string;
  readonly command: "cp" | "mv";
  readonly args: readonly string[];
  readonly files: Readonly<Record<string, string>>;
  readonly links?: Readonly<Record<string, string>>;
  readonly hardlinks?: Readonly<Record<string, string>>;
}

const binary = "AP/DqQoNACo=", old = "cHJldmlvdXM=";
export const nativeFixtures: readonly NativeFixture[] = [
  { name: "copy binary to missing", command: "cp", args: ["source", "target"], files: { source: binary } },
  { name: "copy binary overwrite", command: "cp", args: ["source", "target"], files: { source: binary, target: old } },
  { name: "copy same hardlink", command: "cp", args: ["source", "target"], files: { source: binary }, hardlinks: { target: "source" } },
  { name: "copy followed source symlink alias", command: "cp", args: ["source", "target"], files: { target: binary }, links: { source: "target" } },
  { name: "copy preserved symlink replaces file", command: "cp", args: ["-P", "source", "target"], files: { referent: binary, target: old }, links: { source: "referent" } },
  { name: "copy preserved symlink replaces symlink", command: "cp", args: ["-P", "source", "target"], files: { referent: binary, other: old }, links: { source: "referent", target: "other" } },
  { name: "copy preserved dangling symlink", command: "cp", args: ["-P", "source", "target"], files: {}, links: { source: "missing" } },
  { name: "move binary to missing", command: "mv", args: ["source", "target"], files: { source: binary } },
  { name: "move binary overwrite", command: "mv", args: ["source", "target"], files: { source: binary, target: old } },
  { name: "move preserved symlink replaces file", command: "mv", args: ["source", "target"], files: { referent: binary, target: old }, links: { source: "referent" } },
  { name: "move no-clobber existing", command: "mv", args: ["-n", "source", "target"], files: { source: binary, target: old } },
  { name: "move same hardlink", command: "mv", args: ["source", "target"], files: { source: binary }, hardlinks: { target: "source" } },
];
