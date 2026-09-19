import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
  columnWarnings: { suppressWarnings: true }
};

async function check(command: string, files: Readonly<Record<string, string>>, stdout: string, stdin = "", settings = options): Promise<void> {
  const fs = new MemoryFileSystem();
  for (const [path, value] of Object.entries(files)) await fs.writeFile(path, new TextEncoder().encode(value));
  const shell = new Shell({ fs }).use(csvkitCommands(settings));
  try {
    const result = await shell.exec(command, { stdin });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout, stderr: "" });
    for (const [path, value] of Object.entries(files)) assert.equal(new TextDecoder().decode(await fs.readFile(path)), value, path);
  } finally { await shell.dispose(); }
}

// Baseline exact bytes are frozen in docs/csvkit/join-operation-reference.json.
test("csvjoin stress: duplicate and null keys form the ordered Cartesian product", async () => {
  const files = {
    "/a.csv": "k,v\na,A\nb,B\na,C\nnull,N\n",
    "/b.csv": "k,w\na,X\na,Y\nc,Z\nnull,Q\n"
  };
  await check("csvjoin -I -y0 -c k a.csv b.csv", files, "k,v,w\na,A,X\na,A,Y\na,C,X\na,C,Y\n,N,Q\n");
  await check("csvjoin -I -y0 --right -c k a.csv b.csv", files, "k,w,v\na,X,A\na,X,C\na,Y,A\na,Y,C\nc,Z,\n,Q,N\n");
});

test("csvjoin stress: one input infers and serializes every column instead of copying", async () => {
  await check("csvjoin -y0 a.csv", { "/a.csv": "n,flag,duration\n0002,yes,30m\n0010,no,2h\n" },
    "n,flag,duration\n2,True,0:30:00\n10,False,2:00:00\n");
});

test("csvjoin stress: input-specific key names omit each right key and preserve the first key", async () => {
  await check("csvjoin -I -y0 -c id,other,last --left a.csv b.csv c.csv", {
    "/a.csv": "id,a\nx,AX\ny,AY\n",
    "/b.csv": "b,other\nBX,x\nBY,y\n",
    "/c.csv": "c,last\nCX,x\n"
  }, "id,a,b,c\nx,AX,BX,CX\ny,AY,BY,\n");
});

test("csvjoin stress: three-file right join reverses rows and columns from the last input", async () => {
  await check("csvjoin -I -y0 -c id,other,last --right a.csv b.csv c.csv", {
    "/a.csv": "id,a\nx,AX\ny,AY\n",
    "/b.csv": "b,other\nBX,x\nBY,y\n",
    "/c.csv": "c,last\nCY,y\nCZ,z\nCX,x\n"
  }, "c,last,b,a\nCY,y,BY,AY\nCZ,z,,\nCX,x,BX,AX\n");
});

test("csvjoin stress: multi-file outer joins keep null first keys and deconflict generated names", async () => {
  await check("csvjoin -I -y0 -c k --outer a.csv b.csv c.csv", {
    "/a.csv": "k,a\nx,AX\n",
    "/b.csv": "k,b\ny,BY\n",
    "/c.csv": "k,c\ny,CY\nnull,CN\n"
  }, "k,a,k2,b,k2_2,c\nx,AX,,,,\n,,y,BY,,CN\n,,,,y,CY\n");
});

test("csvjoin stress: sequential joins preserve longer tails across three inputs", async () => {
  await check("csvjoin -I -y0 a.csv b.csv c.csv", {
    "/a.csv": "a\nA\n",
    "/b.csv": "b\nB\nBB\nBBB\n",
    "/c.csv": "c\nC\nCC\n"
  }, "a,b,c\nA,B,C\n,BB,CC\n,BBB,\n");
});

test("csvjoin stress: outer combined with left or right keeps source precedence", async () => {
  const files = { "/a.csv": "k,a\nx,A\n", "/b.csv": "k,b\ny,B\n" };
  await check("csvjoin -I -y0 -c k --outer --left a.csv b.csv", files, "k,a,b\nx,A,\n");
  await check("csvjoin -I -y0 -c k --outer --right a.csv b.csv", files, "k,b,a\ny,B,\n");
});

test("csvjoin stress: per-input text keys remain distinct from inferred numeric keys", async () => {
  await check("csvjoin -y0 -c k a.csv b.csv", {
    "/a.csv": "k,a\n1,AX\nx,AY\n",
    "/b.csv": "k,b\n1,BX\n2,BY\n"
  }, "k,a,b\n");
});

test("csvjoin stress: Python Boolean and Decimal join equality matches True to one", async () => {
  await check("csvjoin -y0 -c k a.csv b.csv", {
    "/a.csv": "k,a\nyes,AX\nno,AY\n",
    "/b.csv": "k,b\n1,BX\n2,BY\n"
  }, "k,a,b\nTrue,AX,BX\n");
});

test("csvjoin stress: Decimal equality ignores scale while preserving large integer identity", async () => {
  await check("csvjoin -y0 -c k a.csv b.csv", {
    "/a.csv": "k,a\n9007199254740993,AX\n9007199254740992,AY\n",
    "/b.csv": "k,b\n9007199254740993.00,BX\n9007199254740992.01,BY\n"
  }, "k,a,b\n9007199254740993,AX,BX\n");
});

test("csvjoin stress: Date and DateTime keys remain distinct even at midnight", async () => {
  await check("csvjoin -y0 -c k a.csv b.csv", {
    "/a.csv": "k,a\n2024-01-01,AX\n",
    "/b.csv": "k,b\n2024-01-01T00:00:00,BX\n"
  }, "k,a,b\n");
});

test("csvjoin stress: aware datetime keys compare instants and serialize with T", async () => {
  await check("csvjoin -y0 -c k a.csv b.csv", {
    "/a.csv": "k,a\n2024-01-01T00:00:00+00:00,AX\n",
    "/b.csv": "k,b\n2023-12-31T19:00:00-05:00,BX\n"
  }, "k,a,b\n2024-01-01T00:00:00+00:00,AX,BX\n");
});

test("csvjoin stress: independently parsed duration spellings compare microseconds", async () => {
  await check("csvjoin -y0 -c k a.csv b.csv", {
    "/a.csv": "k,a\n30m,AX\n", "/b.csv": "k,b\n0:30:00,BX\n"
  }, "k,a,b\n0:30:00,AX,BX\n");
});

test("csvjoin stress: zero flag does not change the helper's one-based key offset", async () => {
  await check("csvjoin -I -y0 --zero -c 1 a.csv b.csv", {
    "/a.csv": "k,a\nx,AX\n", "/b.csv": "k,b\nx,BX\n"
  }, "k,a,b\nx,AX,BX\n");
});

test("csvjoin stress: stdin reusable byte views are retained before producer advancement", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  let closed = 0;
  const stdin = { async *[Symbol.asyncIterator]() {
    const bytes = new Uint8Array(64);
    try {
      for (const fragment of ["n,label\n", "10,first\n", "2,second\n"]) {
        const encoded = new TextEncoder().encode(fragment);
        bytes.set(encoded);
        yield bytes.subarray(0, encoded.length);
        bytes.fill(120);
      }
    } finally { closed++; bytes.fill(120); }
  } };
  try {
    const result = await shell.exec("csvjoin -y0", { stdin });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 0, stdout: "n,label\n10,first\n2,second\n", stderr: ""
    });
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});

test("csvjoin stress: duplicate expansion is bounded before any table output", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a.csv", new TextEncoder().encode("k,a\nx,A\nx,AA\nx,AAA\n"));
  await fs.writeFile("/b.csv", new TextEncoder().encode("k,b\nx,B\nx,BB\nx,BBB\n"));
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, limits: { maxRows: 8 } }));
  try {
    const result = await shell.exec("csvjoin -I -y0 -c k a.csv b.csv");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 78, stdout: "", stderr: "csvkit: unsupported or unqualified: join result row budget exceeded\n"
    });
  } finally { await shell.dispose(); }
});

test("csvjoin stress: cancellation during named materialization cooperatively closes the producer", async () => {
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  let started!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {
    release = () => { resolve({ done: true, value: undefined }); };
  });
  let returned = 0;
  Object.assign(fs, {
    async readFile() { assert.fail("stream-capable input must not bulk-read"); },
    readStream(path: string) {
      assert.equal(path, "/pending.csv");
      return { [Symbol.asyncIterator]: () => ({
        next: () => { started(); return pending; },
        return: async () => { returned++; release(); return { done: true, value: undefined }; }
      }) };
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(options));
  const execution = shell.exec("csvjoin -I -y0 pending.csv", {
    signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() { assert.fail("named input must not acquire stdin"); yield new Uint8Array(); } }
  });
  const rejection = assert.rejects(execution, reason => reason === false);
  try {
    await admitted;
    controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(returned, 1);
    await rejection;
  } finally {
    release();
    await rejection;
    await shell.dispose();
  }
});
