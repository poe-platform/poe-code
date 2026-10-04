import { expect, it, vi } from "vitest";
import { decodePdfString, decodeStoredPdfString } from "./ast.js";

it("decodes growing UTF-16 strings without a resident code-unit array", () => {
  const bytes = new Uint8Array(131074); bytes.set([254,255]);
  for (let i=2;i<bytes.length;i+=2) bytes[i+1]=65;
  const push = Array.prototype.push;
  const spy = vi.spyOn(Array.prototype,"push").mockImplementation(function(this: unknown[],...items: unknown[]) {
    if (this.length+items.length>64) throw Error("resident UTF-16 units");
    return push.apply(this,items);
  });
  let value: string;
  try { value=decodePdfString({kind:"string",bytes}); } finally { spy.mockRestore(); }
  expect(value!).toBe("A".repeat(65536));
});

it.each([
  [[254,255,0,65,216,61,222,0,216,0,0,66,220,0,0],"A😀�B�"],
  [[255,254,65,0,61,216,0,222,0,216,66,0,0,220,0],"A😀�B�"],
  [[239,187,191,65,240,159,152,128,195],"A😀�"],
  [[128,160,173,65],"•€�A"], [[],""], [[254],"þ"], [[254,255],""], [[254,255,0],""],
] as const)("streams stored string case %# with exact PDF decoding", async (input,expected) => {
  for (const shift of [0,4093,4094,4095]) {
    // Put the boundary inside a long sequence without changing its BOM.
    const bytes = Uint8Array.from(input);
    const prefix = input.length>=2&&(input[0]===254||input[0]===255)?2:input[0]===239?3:0;
    const padding = new Uint8Array(shift * (prefix===2?2:1));
    if(prefix===2)for(let i=0;i<padding.length;i+=2)padding[i+(input[0]===254?1:0)]=88;
    else padding.fill(88);
    const data=new Uint8Array(bytes.length+padding.length);data.set(bytes.subarray(0,prefix));data.set(padding,prefix);data.set(bytes.subarray(prefix),prefix+padding.length);
    const loan=new Uint8Array(4096);let reads=0;
    const storage={allocate(){throw Error("unexpected allocation");},async write(){throw Error("unexpected write");},async read(at:number,n:number){expect(n).toBeLessThanOrEqual(4096);reads++;loan.fill(0);loan.set(data.subarray(at,at+n));return loan.subarray(0,n);}};
    let actual="";
    for await(const text of decodeStoredPdfString({storage,position:0,byteLength:data.length})) {expect(text.length).toBeLessThanOrEqual(4096);actual+=text;loan.fill(255);}
    expect(actual).toBe("X".repeat(shift)+expected);expect(reads).toBe(Math.ceil(data.length/4096));
  }
});

it("stops retained reads on early return and preserves cancellation and backend errors", async () => {
  const reason={kind:"stop"},controller=new AbortController();let reads=0;
  const storage={allocate(){throw Error("allocate");},async write(){throw Error("write");},async read(at:number,n:number){reads++;return new Uint8Array(n).fill(65);}};
  const value={storage,position:0,byteLength:20000};
  const work=decodeStoredPdfString(value,controller.signal);await work.next();expect(reads).toBe(1);
  controller.abort(reason);await expect(work.next()).rejects.toBe(reason);expect(reads).toBe(1);
  const early=decodeStoredPdfString(value);await early.next();await early.return();expect(reads).toBe(2);
  await expect(decodeStoredPdfString({...value,storage:{...storage,async read(){throw reason;}}}).next()).rejects.toBe(reason);
  await expect(decodeStoredPdfString({...value,storage:{...storage,async read(){return new Uint8Array(0);}}}).next()).rejects.toThrow("Incomplete");
  await expect(decodeStoredPdfString({...value,position:Number.MAX_SAFE_INTEGER}).next()).rejects.toThrow("range");
});

it("lets timer cancellation interrupt a generated long string", async () => {
  const reason={kind:"timer"},controller=new AbortController();
  const storage={allocate(){throw Error("allocate");},async write(){throw Error("write");},async read(at:number,n:number){return new Uint8Array(n).fill(65);}};
  setTimeout(()=>controller.abort(reason),0);
  await expect(async()=>{for await(const part of decodeStoredPdfString({storage,position:0,byteLength:2_000_000},controller.signal))void part;}).rejects.toBe(reason);
});
