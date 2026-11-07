import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { createSyntheticMp4,probeMp4 } from '@poe-code/mp4-ast';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createCommandArguments } from 'safe-bash-contracts/command';
import { createFfprobeCommand, formatFfprobeResult } from './media.js';

for (const channels of [1, 2]) for (const route of ['file', 'stdin', 'stream']) it(`reports AAC frame channel layout: channels=${channels}, ${route}`, async () => {
  const bytes = channels === 1
    ? readFileSync(new URL('../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4', import.meta.url))
    : createSyntheticMp4({ frameCount: 4, includeAudio: true, channels });
  const base = new MemoryFileSystem();
  await base.writeFile('/input.mp4', bytes);
  const capabilities = { ...base.capabilities, retainedRead: false, streamingRead: true };
  const fs = route === 'stream' ? new Proxy(base, { get(target, key) {
    if (key === 'capabilities') return capabilities;
    if (key === 'capabilitiesFor') return async () => capabilities;
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } }) : base;
  let output = '', diagnostic = '';
  const result = await createFfprobeCommand().execute({
    command: 'ffprobe', ...createCommandArguments([
      '-v', 'error', '-select_streams', 'a:0', '-show_entries',
      'stream=index,codec_type,channels,channel_layout:frame=stream_index,channels,channel_layout',
      '-of', 'json', route === 'stdin' ? '-' : '/input.mp4'
    ]), cwd: '/', env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  const probe = JSON.parse(output);
  const channel_layout = channels === 1 ? 'mono' : 'stereo';
  expect(probe.streams).toEqual([{ index: 1, codec_type: 'audio', channels, channel_layout }]);
  expect(probe.frames.length).toBeGreaterThan(0);
  for (const frame of probe.frames) expect(frame).toEqual({ stream_index: 1, channels, channel_layout });
});

for(const fragmented of [false,true])for(const route of ['explicit','automatic','stdin','stream'])for(const selected of [false,true])for(const mixed of [false,true])it(`native MP4 frame source ${route}, fragmented=${fragmented},selected=${selected},mixed=${mixed}`,async()=>{
  const bytes=createSyntheticMp4({frameCount:4,includeAudio:true,channels:1,fragmented}),expected=probeMp4(bytes,{showFrames:true,showPackets:mixed}),base=new MemoryFileSystem();await base.writeFile('/input.mp4',bytes);
  let closed=0,output='',diagnostic='';
  const capabilities={...base.capabilities,retainedRead:route!=='stream',streamingRead:true};
  const fs=new Proxy(base,{get(target,key){
    if(key==='readFile')return()=>{throw new Error('whole input forbidden');};
    if(key==='capabilities')return capabilities;if(key==='capabilitiesFor')return async()=>capabilities;
    if(key==='openReadFile')return async()=>({stat:()=>base.stat('/input.mp4'),async read(offset:number,length:number){expect(closed).toBe(0);expect(length).toBeLessThanOrEqual(16384);return bytes.slice(offset,offset+length);},async close(){closed++;}});
    if(key==='readStream')return async function*(){try{for(let offset=0;offset<bytes.length;offset+=71)yield bytes.subarray(offset,offset+71);}finally{closed++;}};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
  const args=[...(route==='explicit'?['-f','mp4']:[]),...(mixed?['-show_packets']:[]),...(selected?['-show_entries','frame=stream_index,pts,pkt_size']:['-show_frames']),'-of','json',route==='stdin'?'-':'/input.mp4'];
  const result=await createFfprobeCommand().execute({command:'ffprobe',...createCommandArguments(args),cwd:'/',env:{},fs,signal:new AbortController().signal,stdin:{async *[Symbol.asyncIterator](){try{yield bytes;}finally{closed++;}}},stdout:{async write(chunk){expect(closed).toBe(1);output+=new TextDecoder().decode(chunk);}},stderr:{async write(chunk){diagnostic+=new TextDecoder().decode(chunk);}}});
  expect(result.exitCode,diagnostic).toBe(0);
  const parsed = JSON.parse(output);
  const records = mixed ? {
    packets: parsed.packets_and_frames.filter((row: { type: string }) => row.type === 'packet').map(({ type: _type, ...row }: Record<string, unknown>) => row),
    frames: parsed.packets_and_frames.filter((row: { type: string }) => row.type === 'frame').map(({ type: _type, ...row }: Record<string, unknown>) => row)
  } : parsed;
  expect(records).toEqual({...(mixed?{packets:expected.packets}:{}),frames:selected?expected.frames?.map(({stream_index,pts,pkt_size})=>({stream_index,pts,pkt_size})):JSON.parse(JSON.stringify(expected.frames))});expect(closed).toBe(1);expect((await base.readdir('/')).map(e=>e.name)).toEqual(['input.mp4']);
});

for(const writer of ['default','csv','compact','flat'])it(`formats selected frame fields with ${writer}`,()=>{
  const probe=probeMp4(createSyntheticMp4({frameCount:1,includeAudio:false}),{showFrames:true});
  const output=formatFfprobeResult(probe,{printFormat:writer,showFormat:false,showStreams:false,showFrames:true,showPackets:false,showChapters:false,showPrograms:false,showEntries:'frame=stream_index,pts,pkt_size'});
  const size=probe.frames![0]!.pkt_size;
  const expected=writer==='csv'?`frame,0,0,${size}\n`:writer==='compact'?`frame|stream_index=0|pts=0|pkt_size=${size}\n`:writer==='flat'?`frames.frame.0.stream_index=0\nframes.frame.0.pts=0\nframes.frame.0.pkt_size="${size}"\n`:`[FRAME]\nstream_index=0\npts=0\npkt_size=${size}\n[/FRAME]\n`;
  expect(output).toBe(expected);
});

for (const mixed of [false, true]) it(`emits B-frames in presentation order, mixed=${mixed}`, async () => {
  const bytes = readFileSync(new URL('../../mp4-ast/src/fixtures/h264-b-frames.mp4', import.meta.url));
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input.mp4', bytes);
  let output = '', diagnostic = '';
  const result = await createFfprobeCommand().execute({
    command: 'ffprobe',
    ...createCommandArguments(['-v', 'error', '-select_streams', 'v:0', '-show_frames',
      ...(mixed ? ['-show_packets'] : []), '-show_entries', 'frame=pts' + (mixed ? ':packet=pts' : ''), '-of', 'json', '/input.mp4']),
    cwd: '/', env: {}, fs, signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  const parsed = JSON.parse(output);
  const frames = mixed ? parsed.packets_and_frames.filter((row: { type: string }) => row.type === 'frame').map(({ pts }: { pts: number }) => ({ pts })) : parsed.frames;
  expect(frames).toEqual(Array.from({ length: 20 }, (_, i) => ({ pts: i * 1024 })));
  if (mixed) {
    // Native ffprobe delays the first decoded frame until the third packet.
    expect(parsed.packets_and_frames.slice(0, 8)).toEqual([
      { type: 'packet', pts: 0 }, { type: 'packet', pts: 4096 }, { type: 'packet', pts: 2048 },
      { type: 'frame', pts: 0 }, { type: 'packet', pts: 1024 }, { type: 'frame', pts: 1024 },
      { type: 'packet', pts: 3072 }, { type: 'frame', pts: 2048 }
    ]);
    expect(parsed.packets_and_frames.slice(-2)).toEqual([{ type: 'frame', pts: 18432 }, { type: 'frame', pts: 19456 }]);
  }
  if (mixed) expect(parsed.packets_and_frames.filter((row: { type: string }) => row.type === 'packet').map(({ pts }: { pts: number }) => ({ pts })).slice(0, 5)).toEqual([0, 4096, 2048, 1024, 3072].map(pts => ({ pts })));
});

for (const fixture of ['packet-positions-faststart.mp4', 'packet-positions-interleaved.mp4', 'h264-b-frames.mp4']) it(`reports decoded frame DTS for ${fixture}`, async () => {
  const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}`, import.meta.url));
  const fs = new MemoryFileSystem();
  await fs.writeFile('/input.mp4', bytes);
  let output = '', diagnostic = '';
  const result = await createFfprobeCommand().execute({
    command: 'ffprobe',
    ...createCommandArguments(['-v', 'error', '-select_streams', 'v:0', '-show_frames',
      '-show_entries', 'frame=media_type,pts,pkt_dts,pkt_dts_time', '-of', 'json', '/input.mp4']),
    cwd: '/', env: {}, fs, signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  // Native ffprobe emits two delayed frames without a packet DTS at EOF.
  const count = fixture === 'h264-b-frames.mp4' ? 20 : 5;
  const step = count === 20 ? 1024 : 2048;
  expect(JSON.parse(output).frames.filter((frame: { media_type: string }) => frame.media_type === 'video')).toEqual(Array.from({ length: count }, (_, i) => ({
    media_type: 'video', pts: i * step,
    ...(i < count - 2 ? { pkt_dts: i * step, pkt_dts_time: (i * step / 10240).toFixed(6) } : {})
  })));
});
