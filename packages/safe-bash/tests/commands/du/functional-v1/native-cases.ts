export interface NativeCase {
  readonly id: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export const explicitDiagnostics: Readonly<Record<string, string>> = {
  "explicit-invalid-1": "du: invalid block size ''\n",
  "explicit-invalid-2": "du: invalid block size 'bad'\n",
  "explicit-invalid-3": "du: invalid or unsafe block size '0'\n",
  "explicit-invalid-4": "du: invalid block size '-1'\n",
  "explicit-invalid-5": "du: invalid block size '1.5K'\n",
};

const apparent = ["--apparent-size", "file"];
const environments: readonly Readonly<Record<string, string>>[] = [
  {}, { POSIXLY_CORRECT: "" }, { POSIXLY_CORRECT: "1" },
  { DU_BLOCK_SIZE: "bad" }, { DU_BLOCK_SIZE: "" },
  { DU_BLOCK_SIZE: "bad", POSIXLY_CORRECT: "" },
  { DU_BLOCK_SIZE: "", POSIXLY_CORRECT: "1" },
  { DU_BLOCK_SIZE: "bad", BLOCK_SIZE: "1", BLOCKSIZE: "2K" },
  { DU_BLOCK_SIZE: "", BLOCK_SIZE: "1", BLOCKSIZE: "2K" },
  { DU_BLOCK_SIZE: "bad", BLOCK_SIZE: "1", POSIXLY_CORRECT: "" },
  { DU_BLOCK_SIZE: "", BLOCK_SIZE: "1", POSIXLY_CORRECT: "" },
  { BLOCK_SIZE: "bad", BLOCKSIZE: "1" }, { BLOCK_SIZE: "", BLOCKSIZE: "1" },
  { BLOCK_SIZE: "bad", BLOCKSIZE: "1", POSIXLY_CORRECT: "" },
  { BLOCK_SIZE: "", BLOCKSIZE: "1", POSIXLY_CORRECT: "" },
  { BLOCKSIZE: "bad" }, { BLOCKSIZE: "" },
  { BLOCKSIZE: "bad", POSIXLY_CORRECT: "" }, { BLOCKSIZE: "", POSIXLY_CORRECT: "" },
  { DU_BLOCK_SIZE: "1", BLOCK_SIZE: "bad", BLOCKSIZE: "bad" },
  { DU_BLOCK_SIZE: "K", BLOCK_SIZE: "1" }, { BLOCK_SIZE: "1", BLOCKSIZE: "bad" },
  { BLOCKSIZE: "1" }, { DU_BLOCK_SIZE: "0" }, { DU_BLOCK_SIZE: "-1" },
];

export const nativeCases: readonly NativeCase[] = [
  ...environments.map((env, index) => ({ id: `env-${String(index + 1).padStart(2, "0")}`, args: apparent, env })),
  { id: "explicit-bytes-over-invalid", args: ["-b", "file"], env: { DU_BLOCK_SIZE: "bad", POSIXLY_CORRECT: "" } },
  { id: "explicit-k-over-empty", args: ["--apparent-size", "-k", "file"], env: { DU_BLOCK_SIZE: "", BLOCK_SIZE: "1", POSIXLY_CORRECT: "" } },
  { id: "explicit-unit-over-invalid", args: ["--apparent-size", "-B1", "file"], env: { DU_BLOCK_SIZE: "bad" } },
  ...["", "bad", "0", "-1", "1.5K"].map((value, index) => ({ id: `explicit-invalid-${index + 1}`, args: ["--apparent-size", "-B", value, "file"], env: { DU_BLOCK_SIZE: "1" } })),
  { id: "empty-only", args: ["-b", ""], env: {} },
  { id: "empty-then-file", args: ["-b", "", "file"], env: {} },
  { id: "file-then-empty", args: ["-b", "file", ""], env: {} },
];
