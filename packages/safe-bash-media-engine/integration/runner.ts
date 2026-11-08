// Test-only raw POSIX argv launcher. Never exported or used as a product fallback.
import { spawn } from "node:child_process";
export async function runNative(executable: string, argv: readonly Uint8Array[], context: { cwd: string; env: Record<string, string>; stdin: Uint8Array; descriptors?: readonly { fd: number; path: string; mode: 'read' | 'write' }[] }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const script = `import base64,fcntl,json,os,subprocess,sys
r=json.load(sys.stdin)
descriptors=r.get('descriptors',[])
targets=[d['fd'] for d in descriptors]
if len(set(targets))!=len(targets) or any(type(fd)!=int or fd<3 for fd in targets):
    raise ValueError('Invalid fixture descriptor mapping')
owned=[]
try:
    # Retain sources above all targets before remapping, so crossed fd numbers
    # cannot overwrite another source. These are explicit borrowed fixtures,
    # never files inferred from argv or predictive dependencies.
    for d in descriptors:
        source=os.open(os.path.join(r['cwd'],d['path']),os.O_RDONLY if d['mode']=='read' else os.O_WRONLY|os.O_TRUNC)
        try:
            owned.append(fcntl.fcntl(source,fcntl.F_DUPFD_CLOEXEC,max(targets)+1))
        finally:
            os.close(source)
    for source,target in zip(owned,targets):
        os.dup2(source,target)
    p=subprocess.run([r['executable'].encode()]+[base64.b64decode(a) for a in r['argv']],cwd=r['cwd'],env=r['env'],input=base64.b64decode(r['stdin']),stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=targets,timeout=5)
finally:
    for fd in owned+targets:
        try:
            os.close(fd)
        except OSError:
            pass
print(json.dumps({'exitCode':p.returncode,'stdout':base64.b64encode(p.stdout).decode(),'stderr':base64.b64encode(p.stderr).decode()}))`;
  const child = spawn("/usr/bin/python3", ["-c", script], { stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", data => stdout.push(data));
  child.stderr.on("data", data => stderr.push(data));
  const complete = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(Buffer.concat(stderr).toString())));
    child.stdin.once("error", reject);
  });
  child.stdin.end(JSON.stringify({ executable, argv: argv.map(arg => Buffer.from(arg).toString("base64")), cwd: context.cwd, env: context.env, stdin: Buffer.from(context.stdin).toString("base64"), descriptors: context.descriptors }));
  await complete;
  return JSON.parse(Buffer.concat(stdout).toString());
}
