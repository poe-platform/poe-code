import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {vol,fs} from 'memfs';
const mocked=vi.hoisted(()=>({listen:vi.fn(),encrypt:vi.fn(),word:vi.fn(),access:vi.fn()}));
vi.mock('../dist/index.js',()=>({createEncryptServer:mocked.encrypt,createWordOfTheDayServer:mocked.word}));
vi.mock('node:fs',async original=>({...await original<typeof import('node:fs')>(),existsSync:fs.existsSync,readFileSync:fs.readFileSync,writeFileSync:fs.writeFileSync}));
vi.mock('node:fs/promises',()=>({access:mocked.access}));
import {runCli} from '../dist/cli.js';
let output:string[],errors:string[];
beforeEach(()=>{
 vol.reset();vi.resetAllMocks();vi.useFakeTimers();output=[];errors=[];
 for(const name of ['TOOLCRAFT_TEST_SPAWN_COUNT_FILE','TOOLCRAFT_TEST_WRAPPER_PID_FILE','TOOLCRAFT_TEST_STARTUP_DELAY_MS','TOOLCRAFT_TEST_STARTUP_GATE_FILE'])vi.stubEnv(name,undefined);
 vi.spyOn(process.stdout,'write').mockImplementation((value:any)=>{output.push(String(value));return true;});
 vi.spyOn(process.stderr,'write').mockImplementation((value:any)=>{errors.push(String(value));return true;});
 mocked.listen.mockResolvedValue(undefined);mocked.encrypt.mockReturnValue({listen:mocked.listen});mocked.word.mockReturnValue({listen:mocked.listen});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks();vol.reset();});
it('records the counter and PID before delaying and polling a startup gate',async()=>{
 vol.fromJSON({'/count':'00041\n'});vi.stubEnv('TOOLCRAFT_TEST_SPAWN_COUNT_FILE','/count');vi.stubEnv('TOOLCRAFT_TEST_WRAPPER_PID_FILE','/pid');vi.stubEnv('TOOLCRAFT_TEST_STARTUP_DELAY_MS','0x10');vi.stubEnv('TOOLCRAFT_TEST_STARTUP_GATE_FILE','/gate');
 mocked.access.mockImplementationOnce(async()=>{expect(fs.readFileSync('/count','utf8')).toBe('42');expect(fs.readFileSync('/pid','utf8')).toBe(String(process.pid));throw Error('not ready');}).mockResolvedValue(undefined);
 const running=runCli(['serve','encrypt']);expect(mocked.access).not.toHaveBeenCalled();expect(mocked.listen).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(16);expect(mocked.access).toHaveBeenCalledTimes(1);expect(mocked.listen).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(5);expect(await running).toBe(0);expect(mocked.access).toHaveBeenCalledTimes(2);expect(mocked.access).toHaveBeenCalledWith('/gate');expect(mocked.encrypt).toHaveBeenCalledTimes(1);expect(mocked.word).not.toHaveBeenCalled();expect(errors).toEqual([]);expect(output).toEqual([]);expect(vi.getTimerCount()).toBe(0);
});
it('initializes an absent counter and serves the word fixture',async()=>{
 vi.stubEnv('TOOLCRAFT_TEST_SPAWN_COUNT_FILE','/count');expect(await runCli(['serve','word-of-the-day'])).toBe(0);expect(fs.readFileSync('/count','utf8')).toBe('1');expect(mocked.word).toHaveBeenCalledTimes(1);expect(mocked.encrypt).not.toHaveBeenCalled();
});
it('rejects unknown tools before touching counters, PID or startup gates',async()=>{
 vi.stubEnv('TOOLCRAFT_TEST_SPAWN_COUNT_FILE','/missing-parent/count');vi.stubEnv('TOOLCRAFT_TEST_WRAPPER_PID_FILE','/pid');vi.stubEnv('TOOLCRAFT_TEST_STARTUP_GATE_FILE','/gate');
 expect(await runCli(['serve','constructor'])).toBe(1);expect(errors).toEqual(['Unknown tool: constructor. Available: encrypt, word-of-the-day\n']);expect(fs.existsSync('/pid')).toBe(false);expect(mocked.access).not.toHaveBeenCalled();expect(mocked.listen).not.toHaveBeenCalled();
});
it('rejects malformed counters before writing a PID or starting a server',async()=>{
 vol.fromJSON({'/count':'1e2'});vi.stubEnv('TOOLCRAFT_TEST_SPAWN_COUNT_FILE','/count');vi.stubEnv('TOOLCRAFT_TEST_WRAPPER_PID_FILE','/pid');
 expect(await runCli(['serve','encrypt'])).toBe(1);expect(errors).toEqual(['TOOLCRAFT_TEST_SPAWN_COUNT_FILE must contain a non-negative integer\n']);expect(fs.readFileSync('/count','utf8')).toBe('1e2');expect(fs.existsSync('/pid')).toBe(false);expect(mocked.listen).not.toHaveBeenCalled();
});
it('reports startup filesystem and listener failures without dangling timers',async()=>{
 vi.stubEnv('TOOLCRAFT_TEST_SPAWN_COUNT_FILE','/missing-parent/count');expect(await runCli(['serve','encrypt'])).toBe(1);expect(errors.join('')).toContain('ENOENT');expect(mocked.listen).not.toHaveBeenCalled();
 vi.stubEnv('TOOLCRAFT_TEST_SPAWN_COUNT_FILE',undefined);errors.length=0;mocked.listen.mockRejectedValue(Error('listen failed'));
 expect(await runCli(['serve','encrypt'])).toBe(1);expect(errors).toEqual(['listen failed\n']);expect(vi.getTimerCount()).toBe(0);
});
