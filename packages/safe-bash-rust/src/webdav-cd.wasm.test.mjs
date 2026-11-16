import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) for (const readOnly of [false,true]) {
  test(`${runtime} WebDAV cd uses metadata only${readOnly ? " through readonly" : ""}`, {skip:!WebAssembly.Suspending}, async () => {
    const {Shell}=await import("@poe-platform/safe-bash");
    const {WebDavFileSystem}=await import("@poe-platform/safe-bash/fs/webdav");
    const {ReadOnlyFileSystem}=await import("@poe-platform/safe-bash/fs/readonly");
    const requests=[];
    const backing=new WebDavFileSystem({baseUrl:"https://example.test/dav/",fetch:async(url,init)=>{
      requests.push([init.method,new Headers(init.headers).get("Depth"),new URL(url).pathname]);
      return new Response('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/folder</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',{status:207,headers:{"Content-Type":"application/xml"}});
    }});
    const fs=readOnly ? new ReadOnlyFileSystem(backing) : backing;
    const shell=runtime === "TypeScript" ? new Shell({fs,cwd:"/"}) : new RustWasmBash({fs,cwd:"/",forceNative:true});
    try {
      const result=await shell.exec("cd /folder; pwd");
      assert.deepEqual([result.stdout,result.stderr,result.exitCode],["/folder\n","",0]);
      assert.ok(requests.length>0);
      for(const request of requests) assert.deepEqual(request,["PROPFIND","0","/dav/folder"]);
      if(runtime === "Rust") assert.equal(shell._companion,null);
    } finally {await shell.dispose();}
  });
}
