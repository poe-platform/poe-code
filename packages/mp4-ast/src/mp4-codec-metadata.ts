import { BinaryReader } from './binary.js';
import { H264_COLOR_SPACES, parseH264Sps } from './codecs.js';
import type { MediaCodecDescription, MediaTrackType } from './types.js';
import type { Mp4AudioSpecificMetadata } from './esds-source.js';

export type Mp4CodecMetadata = Omit<MediaCodecDescription, 'avcC' | 'hvcC' | 'av1C' | 'vpcC' | 'esds' | 'dOps' | 'rawStsdEntryBytes'>;
type MutableMetadata = { -readonly [K in keyof Mp4CodecMetadata]: Mp4CodecMetadata[K] };
export type CodecEntryState = { metadata: MutableMetadata; kind?: 'video' | 'audio'; childOffset?: number; nclx?: Uint8Array };
export type CodecMetadataChild =
  | { type: 'avcC'; extradataSize: number; profileIdc: number; profileCompatibility: number; levelIdc: number; nalLengthSize: number; sps?: Uint8Array | undefined }
  | { type: 'hvcC'; generalLevelIdc: number; generalProfileIdc: number; bitDepthLumaMinus8: number }
  | { type: 'av1C'; seqProfile: number; seqLevelIdx0: number; highBitdepth: boolean }
  | { type: 'vpcC'; profile: number; level: number }
  | { type: 'esds' | 'wave-esds'; config: Mp4AudioSpecificMetadata }
  | { type: 'dOps'; inputSampleRate: number; outputChannelCount: number }
  | { type: 'colr'; payload: Uint8Array }
  | { type: 'pasp'; sarWidth: number; sarHeight: number };

/** Scalar interpretation shared by resident entries and caller-owned source ranges. */
export function sampleEntryHeader(formatFourCC: string, body: Uint8Array): CodecEntryState {
  const metadata: MutableMetadata = { formatFourCC, codecName: formatFourCC.trim().toLowerCase(), codecTagString: formatFourCC,
    profile: undefined, level: undefined, width: undefined, height: undefined, pixFmt: undefined,
    sarWidth: undefined, sarHeight: undefined, sampleRate: undefined, channels: undefined, bitsPerSample: undefined };
  const state: CodecEntryState = { metadata }, reader = new BinaryReader(body);
  if (['avc1','avc3','hvc1','hev1','av01','vp08','vp09','mp4v','jpeg','mjpa','png ','s263','raw '].includes(formatFourCC)) {
    state.kind = 'video';
    if (body.length >= 78) {
      reader.skip(24); metadata.width = reader.readU16BE(); metadata.height = reader.readU16BE();
      reader.seek(42);
      const nameLength = Math.min(reader.readU8(), 31);
      metadata.compressorName = reader.readNullTerminatedString(nameLength);
      if (formatFourCC === 'raw ') {
        reader.seek(74);
        metadata.pixFmt = ({ 16: 'rgb555be', 24: 'rgb24', 32: 'argb' } as Record<number, string>)[reader.readU16BE()];
      }
      state.childOffset = 78;
    }
  } else if (['mp4a','Opus','fLaC','alac','ac-3','ec-3','sowt','twos','lpcm','.mp3','ulaw','alaw','ima4','samr','sawb'].includes(formatFourCC)) {
    state.kind = 'audio';
    if (body.length >= 28) {
      reader.skip(8); const version = reader.readU16BE(); reader.skip(6);
      metadata.channels = reader.readU16BE(); metadata.bitsPerSample = reader.readU16BE(); reader.skip(4);
      metadata.sampleRate = Math.round(reader.readU32BE() / 65536);
      state.childOffset = 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
    }
  } else if (formatFourCC === 'tmcd' && body.length >= 28) {
    // Keep the declared time scale and frame duration for timecode stream probing.
    metadata.extraData = body.slice(8, 28);
    metadata.extradataSize = 20;
  }
  return state;
}

export function applyCodecMetadata(state: CodecEntryState, child: CodecMetadataChild): void {
  const metadata = state.metadata;
  if (state.kind === 'video') {
    if (child.type === 'colr') {
      if (child.payload.length >= 11 && new BinaryReader(child.payload).readFourCC() === 'nclx')
        state.nclx = child.payload.subarray(0, 11);
    } else if (child.type === 'avcC') {
      metadata.extradataSize = child.extradataSize;
      metadata.nalLengthSize = child.nalLengthSize;
      metadata.mimeCodecString = `avc1.${[child.profileIdc, child.profileCompatibility, child.levelIdc].map(value => value.toString(16).padStart(2, '0')).join('')}`;
      metadata.codecName = 'h264'; metadata.level = child.levelIdc;
      if (child.sps) {
        const sps = parseH264Sps(child.sps);
        metadata.chromaLocation = sps.chromaLocation;
        metadata.bitDepthLuma = sps.bitDepthLuma;
        metadata.maxNumReorderFrames = sps.maxNumReorderFrames;
        metadata.fieldOrder = sps.fieldOrder;
        if (sps.pictureTiming) metadata.h264PictureTiming = { ...sps.pictureTiming, nalLengthSize: child.nalLengthSize };
        metadata.colorRange = sps.colorRange; metadata.colorSpace = sps.colorSpace;
        metadata.profile = sps.profileName; metadata.width = sps.width || metadata.width; metadata.height = sps.height || metadata.height;
        metadata.pixFmt = sps.pixFmt; metadata.sarWidth = sps.sarWidth; metadata.sarHeight = sps.sarHeight;
      }
    } else if (child.type === 'hvcC') {
      metadata.codecName = 'hevc'; metadata.level = child.generalLevelIdc;
      metadata.profile = child.generalProfileIdc === 2 ? 'Main 10' : 'Main'; metadata.pixFmt = child.bitDepthLumaMinus8 > 0 ? 'yuv420p10le' : 'yuv420p';
    } else if (child.type === 'av1C') {
      metadata.codecName = 'av1'; metadata.profile = child.seqProfile === 0 ? 'Main' : child.seqProfile === 1 ? 'High' : 'Professional';
      metadata.level = child.seqLevelIdx0; metadata.pixFmt = child.highBitdepth ? 'yuv420p10le' : 'yuv420p';
    } else if (child.type === 'vpcC') {
      metadata.codecName = metadata.formatFourCC === 'vp08' ? 'vp8' : 'vp9'; metadata.profile = `Profile ${child.profile}`; metadata.level = child.level; metadata.pixFmt = 'yuv420p';
    } else if (child.type === 'pasp') { metadata.sarWidth = child.sarWidth || 1; metadata.sarHeight = child.sarHeight || 1; }
  } else if (state.kind === 'audio') {
    if (child.type === 'esds' || child.type === 'wave-esds') {
      metadata.extradataSize = child.config.decoderSpecificInfoSize;
      if (child.config.extraDataRange) metadata.extraDataRange = child.config.extraDataRange;
      if (child.config.objectTypeIndication === 0x40 && child.config.audioObjectType > 0)
        metadata.mimeCodecString = `mp4a.40.${child.config.audioObjectType}`;
      if (child.config.sampleRate > 0) metadata.sampleRate = child.config.sampleRate;
      if (child.config.channelCount > 0) metadata.channels = child.config.channelCount;
      if (child.type === 'esds') {
        if (child.config.objectTypeIndication === 0x6b || child.config.objectTypeIndication === 0x69) metadata.codecName = 'mp3';
        else { metadata.codecName = 'aac'; metadata.profile = child.config.audioObjectType === 5 ? 'HE-AAC' : 'LC'; }
      }
    } else if (child.type === 'dOps') {
      metadata.codecName = 'opus'; metadata.sampleRate = child.inputSampleRate || 48000; metadata.channels = child.outputChannelCount || metadata.channels;
    }
  }
}

export function finishCodecMetadata(state: CodecEntryState): Mp4CodecMetadata {
  const metadata = state.metadata, format = metadata.formatFourCC;
  if (state.kind === 'video') {
    const aliases: Record<string,string> = { avc1:'h264',avc3:'h264',hvc1:'hevc',hev1:'hevc',av01:'av1',vp08:'vp8',vp09:'vp9',jpeg:'mjpeg',mjpa:'mjpeg',mp4v:'mpeg4','png ':'png','raw ':'rawvideo' };
    metadata.codecName = aliases[format] ?? metadata.codecName; metadata.pixFmt ??= 'yuv420p';
    // Apply container color after codec children, regardless of box order.
    if (state.nclx) {
      const reader = new BinaryReader(state.nclx);
      reader.skip(4);
      metadata.colorPrimaries = ({ 1: 'bt709', 4: 'bt470m', 5: 'bt470bg', 6: 'smpte170m',
        7: 'smpte240m', 8: 'film', 9: 'bt2020', 10: 'smpte428', 11: 'smpte431',
        12: 'smpte432', 22: 'ebu3213' } as Record<number, string>)[reader.readU16BE()];
      metadata.colorTransfer = ({ 1: 'bt709', 4: 'gamma22', 5: 'gamma28', 6: 'smpte170m',
        7: 'smpte240m', 8: 'linear', 9: 'log100', 10: 'log316', 11: 'iec61966-2-4',
        12: 'bt1361e', 13: 'iec61966-2-1', 14: 'bt2020-10', 15: 'bt2020-12',
        16: 'smpte2084', 17: 'smpte428', 18: 'arib-std-b67' } as Record<number, string>)[reader.readU16BE()];
      metadata.colorSpace = H264_COLOR_SPACES[reader.readU16BE()];
      metadata.colorRange = reader.readU8() & 0x80 ? 'pc' : 'tv';
      if (metadata.codecName === 'h264' && metadata.colorRange === 'pc')
        metadata.pixFmt = ({ yuv420p: 'yuvj420p', yuv422p: 'yuvj422p', yuv444p: 'yuvj444p' } as Record<string, string>)[metadata.pixFmt] ?? metadata.pixFmt;
    }
  } else if (state.kind === 'audio') {
    if (format === 'mp4a' && metadata.codecName === 'mp4a') { metadata.codecName = 'aac'; metadata.profile ??= 'LC'; }
    else {
      const aliases: Record<string,string> = { Opus:'opus',fLaC:'flac',alac:'alac','ac-3':'ac3','ec-3':'eac3',sowt:'pcm_s16le',twos:'pcm_s16be',lpcm:'pcm_s16le','.mp3':'mp3',ulaw:'pcm_mulaw',alaw:'pcm_alaw',ima4:'adpcm_ima_qt',samr:'amr_nb',sawb:'amr_wb' };
      metadata.codecName = aliases[format] ?? metadata.codecName;
    }
    if (format === 'samr' || format === 'sawb') {
      // AMR is compressed mono audio; sample-entry PCM defaults do not apply.
      metadata.sampleRate = format === 'samr' ? 8000 : 16000;
      metadata.channels = 1;
      metadata.bitsPerSample = 0;
    }
  } else if (format === 'tx3g' || format === 'text') metadata.codecName = 'mov_text';
  else if (format === 'wvtt') metadata.codecName = 'webvtt';
  else if (format === 'stpp') metadata.codecName = 'ttml';
  metadata.mimeCodecString ??= ({ mp3: "mp4a.40.34", flac: "flac", vorbis: "vorbis", opus: "opus", ac3: "ac-3", eac3: "ec-3" } as Record<string, string>)[metadata.codecName];
  return metadata;
}

/** Existing general-media PCM naming, shared by resident and source frame probes. */
export function probeSampleFormat(type: MediaTrackType, codecName: string): string | undefined {
  if (type !== 'audio') return undefined;
  return ({ pcm_u8: 'u8', pcm_s8: 'u8', pcm_mulaw: 's16', pcm_alaw: 's16', pcm_vidc: 's16',
    pcm_s16le: 's16', pcm_s16be: 's16', pcm_s24le: 's32', pcm_s24be: 's32',
    pcm_s64le: 's64', pcm_s32le: 's32', pcm_s32be: 's32', pcm_f32le: 'flt', pcm_f32be: 'flt', pcm_f64le: 'dbl', pcm_f64be: 'dbl' } as Record<string, string>)[codecName] ?? 'fltp';
}
