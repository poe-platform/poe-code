import{test}from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';const native=createRequire(import.meta.url)('../dist/terminal-pilot-rust.node');
test('own PTY is a real controlling terminal and reports size, output and exit',async()=>{
 const pty=new native.NativeTerminalPty('/bin/sh',['-c','test -t 0 && test -t 1 && : < /dev/tty && stty size && printf "native tty\\n"; exit 7'],process.cwd(),JSON.stringify(process.env),80,24);let output='';const deadline=Date.now()+3000;let exit;while(Date.now()<deadline){output+=pty.read().toString();exit=pty.exitCode;if(exit!==null&&exit!==undefined){output+=pty.read().toString();break;}await new Promise(resolve=>setTimeout(resolve,2));}assert.equal(exit,7);assert.ok(output.includes("24 80"));assert.ok(output.includes("native tty"));
});
test('PTY input, resize and SIGTERM use the own native transport',async()=>{
 const pty=new native.NativeTerminalPty('/bin/sh',['-c','printf ready; read value; stty size; printf "got:%s\\n" "$value"'],process.cwd(),JSON.stringify(process.env),80,24);pty.resize(91,27);pty.write(Buffer.from('hello\n'));let output='';const deadline=Date.now()+3000;while(Date.now()<deadline){output+=pty.read().toString();if(pty.exitCode!==null&&pty.exitCode!==undefined){output+=pty.read().toString();break;}await new Promise(resolve=>setTimeout(resolve,2));}assert.ok(output.includes("27 91"));assert.ok(output.includes("got:hello"));const sleeping=new native.NativeTerminalPty('/bin/sh',['-c','exec sleep 60'],process.cwd(),JSON.stringify(process.env),80,24);sleeping.signal(15);for(let n=0;n<100&&sleeping.exitCode==null;n++)await new Promise(resolve=>setTimeout(resolve,2));assert.notEqual(sleeping.exitCode,null);
});
test('explicit PTY disposal releases the owned transport and rejects future effects',()=>{
 const pty=new native.NativeTerminalPty('/bin/sh',['-c','exec sleep 60'],process.cwd(),JSON.stringify(process.env),80,24);
 pty.dispose();pty.dispose();
 assert.throws(()=>pty.read(),/disposed/);assert.throws(()=>pty.write(Buffer.from('late')),/disposed/);
});
test('alternate cwd and child PATH preserve the portable spawn behavior',async()=>{
 const pty=new native.NativeTerminalPty('sh',['-c',': < /dev/tty && pwd; printf "env:%s\\n" "$CHECK"; exit 9'],'/',JSON.stringify({PATH:'/bin:/usr/bin',CHECK:'fallback'}),32,4);
 let output='',exit;for(let n=0;n<500;n++){output+=pty.read().toString();exit=pty.exitCode;if(exit!=null){output+=pty.read().toString();break;}await new Promise(resolve=>setTimeout(resolve,2));}
 assert.equal(exit,9);assert.ok(output.startsWith('/\r\n'));assert.ok(output.includes('env:fallback'));pty.dispose();
});
