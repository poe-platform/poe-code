import { BinaryReader } from './binary.js';
import { parseH264Sps } from './codecs.js';
import type { MediaCodecDescription, MediaTrackType } from './types.js';
import type { Mp4AudioSpecificMetadata } from './esds-source.js';

export type Mp4CodecMetadata = Omit<MediaCodecDescription, 'avcC' | 'hvcC' | 'av1C' | 'vpcC' | 'esds' | 'dOps' | 'extraData' | 'rawStsdEntryBytes'>;
type MutableMetadata = { -readonly [K in keyof Mp4CodecMetadata]: Mp4CodecMetadata[K] };
export type CodecEntryState = { metadata: MutableMetadata; kind?: 'video' | 'audio'; childOffset?: number };
export type CodecMetadataChild =
  | { type: 'avcC'; levelIdc: number; sps?: Uint8Array | undefined }
  | { type: 'hvcC'; generalLevelIdc: number; generalProfileIdc: number; bitDepthLumaMinus8: number }
  | { type: 'av1C'; seqProfile: number; seqLevelIdx0: number; highBitdepth: boolean }
  | { type: 'vpcC'; profile: number; level: number }
  | { type: 'esds' | 'wave-esds'; config: Mp4AudioSpecificMetadata }
  | { type: 'dOps'; inputSampleRate: number; outputChannelCount: number }
  | { type: 'pasp'; sarWidth: number; sarHeight: number };

/** Scalar interpretation shared by resident entries and caller-owned source ranges. */
export function sampleEntryHeader(formatFourCC: string, body: Uint8Array): CodecEntryState {
  const metadata: MutableMetadata = { formatFourCC, codecName: formatFourCC.trim().toLowerCase(), codecTagString: formatFourCC,
    profile: undefined, level: undefined, width: undefined, height: undefined, pixFmt: undefined,
    sarWidth: 1, sarHeight: 1, sampleRate: undefined, channels: undefined, bitsPerSample: undefined };
  const state: CodecEntryState = { metadata }, reader = new BinaryReader(body);
  if (['avc1','avc3','hvc1','hev1','av01','vp08','vp09','mp4v','jpeg','mjpa','png ','s263'].includes(formatFourCC)) {
    state.kind = 'video';
    if (body.length >= 78) { reader.skip(24); metadata.width = reader.readU16BE(); metadata.height = reader.readU16BE(); state.childOffset = 78; }
  } else if (['mp4a','Opus','fLaC','alac','ac-3','ec-3','sowt','twos','lpcm','.mp3','ulaw','alaw'].includes(formatFourCC)) {
    state.kind = 'audio';
    if (body.length >= 28) {
      reader.skip(8); const version = reader.readU16BE(); reader.skip(6);
      metadata.channels = reader.readU16BE(); metadata.bitsPerSample = reader.readU16BE(); reader.skip(4);
      metadata.sampleRate = Math.round(reader.readU32BE() / 65536);
      state.childOffset = 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
    }
  }
  return state;
}

export function applyCodecMetadata(state: CodecEntryState, child: CodecMetadataChild): void {
  const metadata = state.metadata;
  if (state.kind === 'video') {
    if (child.type === 'avcC') {
      metadata.codecName = 'h264'; metadata.level = child.levelIdc;
      if (child.sps) {
        const sps = parseH264Sps(child.sps);
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
    const aliases: Record<string,string> = { avc1:'h264',avc3:'h264',hvc1:'hevc',hev1:'hevc',av01:'av1',vp08:'vp8',vp09:'vp9',jpeg:'mjpeg',mjpa:'mjpeg',mp4v:'mpeg4','png ':'png' };
    metadata.codecName = aliases[format] ?? metadata.codecName; metadata.pixFmt ??= 'yuv420p';
  } else if (state.kind === 'audio') {
    if (format === 'mp4a' && metadata.codecName === 'mp4a') { metadata.codecName = 'aac'; metadata.profile ??= 'LC'; }
    else {
      const aliases: Record<string,string> = { Opus:'opus',fLaC:'flac',alac:'alac','ac-3':'ac3','ec-3':'eac3',sowt:'pcm_s16le',twos:'pcm_s16be',lpcm:'pcm_s16le','.mp3':'mp3' };
      metadata.codecName = aliases[format] ?? metadata.codecName;
    }
  } else if (format === 'tx3g' || format === 'text') metadata.codecName = 'mov_text';
  else if (format === 'wvtt') metadata.codecName = 'webvtt';
  else if (format === 'stpp') metadata.codecName = 'ttml';
  return metadata;
}

/** Existing general-media PCM naming, shared by resident and source frame probes. */
export function probeSampleFormat(type: MediaTrackType, codecName: string): string | undefined {
  if (type !== 'audio') return undefined;
  return ({ pcm_u8: 'u8', pcm_s16le: 's16', pcm_s16be: 's16', pcm_s24le: 's32', pcm_s24be: 's32',
    pcm_s32le: 's32', pcm_s32be: 's32', pcm_f32le: 'flt', pcm_f32be: 'flt', pcm_f64le: 'dbl', pcm_f64be: 'dbl' } as Record<string, string>)[codecName] ?? 'fltp';
}
