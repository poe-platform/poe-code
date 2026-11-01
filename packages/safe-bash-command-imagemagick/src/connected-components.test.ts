import {expect,it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {runConvertCli,runConvertCliSync} from "./index.js";

for(const mode of ["buffered","retained","sync"] as const){
 for(const output of ["out.png","null:"])it(`rejects unsupported connected components (${mode}, ${output})`,async()=>{
  const original=new TextEncoder().encode("existing output"),files=new Map([["out.png",original]]),fs=new MemoryFileSystem();
  await fs.writeFile("/out.png",original);
  const args=["-size","7x7","xc:white","-define","connected-components:verbose=true","-connected-components","4",output];
  const result=mode==="sync"?runConvertCliSync(args,files):await runConvertCli(args,mode==="buffered"?files:{filesystem:fs,cwd:"/"});
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Unsupported option: -connected-components");
  expect(result.stdout).toBe("");
  expect(mode==="retained"?await fs.readFile("/out.png"):files.get("out.png")).toEqual(original);
 });
}
