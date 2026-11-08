import type { NativeVideoPixels } from "@poe-code/media-codecs";

/**
 * Consumer-defined resource limits.
 * IMPORTANT: No limits are imposed by default when omitted (`undefined`).
 * Consumers on constrained runtimes (such as Cloudflare Workers) can pass
 * `cloudflareWorkerLimits()` or custom bounds.
 */
export interface MediaResourceLimits {
  readonly maxInputBytes?: number | undefined;
  readonly maxOutputBytes?: number | undefined;
  readonly maxMemoryBytes?: number | undefined;
  readonly maxFrames?: number | undefined;
  readonly maxPixelsPerFrame?: number | undefined;
  readonly maxDurationSeconds?: number | undefined;
  readonly maxStreams?: number | undefined;
  readonly maxSamplesPerTrack?: number | undefined;
  readonly maxConcatInputs?: number | undefined;
  readonly maxBoxDepth?: number | undefined;
  readonly maxCpuMs?: number | undefined;
}

/**
 * Opt-in / opt-out capabilities for heavy operations.
 * All capabilities are enabled by default for full compatibility unless
 * explicitly disabled (`false`) or restricted by consumer configuration.
 */
export interface MediaFeatureOptions {
  readonly videoTranscode?: boolean | undefined;
  readonly audioTranscode?: boolean | undefined;
  readonly filterGraph?: boolean | undefined;
  readonly lavfiSources?: boolean | undefined;
  readonly heavyFilters?: boolean | undefined;
  readonly fragmentedMp4?: boolean | undefined;
  readonly subtitles?: boolean | undefined;
}

/**
 * Sensible preset limits for a standard Cloudflare Worker (128 MB isolate, 30s CPU).
 * Consumers explicitly opt into these limits by passing `cloudflareWorkerLimits()`
 * to AST operations or `ffmpegCommands({ limits: cloudflareWorkerLimits() })`.
 */
export function cloudflareWorkerLimits(
  overrides: Partial<MediaResourceLimits> = {}
): MediaResourceLimits {
  return {
    maxInputBytes: 64 * 1024 * 1024,
    maxOutputBytes: 64 * 1024 * 1024,
    maxMemoryBytes: 96 * 1024 * 1024,
    maxFrames: 900,
    maxPixelsPerFrame: 1920 * 1080,
    maxDurationSeconds: 3600,
    maxStreams: 32,
    maxSamplesPerTrack: 200_000,
    maxConcatInputs: 128,
    maxBoxDepth: 32,
    maxCpuMs: 25_000,
    ...overrides
  };
}

export class MediaLimitExceededError extends Error {
  readonly limitName: keyof MediaResourceLimits;
  readonly limitValue: number;
  readonly actualValue: number;

  constructor(limitName: keyof MediaResourceLimits, limitValue: number, actualValue: number, message?: string) {
    super(
      message ??
        `Resource limit exceeded for ${limitName}: ${actualValue} exceeds maximum allowed ${limitValue}`
    );
    this.name = "MediaLimitExceededError";
    this.limitName = limitName;
    this.limitValue = limitValue;
    this.actualValue = actualValue;
  }
}

export class MediaBudgetTracker {
  readonly limits: MediaResourceLimits;
  readonly startTimeMs: number;
  private allocatedBytes = 0;
  private peakAllocatedBytes = 0;
  private decodedFrames = 0;

  constructor(limits: MediaResourceLimits = {}) {
    this.limits = limits;
    this.startTimeMs = Date.now();
  }

  checkCpu(): void {
    if (this.limits.maxCpuMs !== undefined) {
      const elapsed = Date.now() - this.startTimeMs;
      if (elapsed > this.limits.maxCpuMs) {
        throw new MediaLimitExceededError("maxCpuMs", this.limits.maxCpuMs, elapsed);
      }
    }
  }

  checkInputBytes(bytes: number): void {
    if (this.limits.maxInputBytes !== undefined && bytes > this.limits.maxInputBytes) {
      throw new MediaLimitExceededError("maxInputBytes", this.limits.maxInputBytes, bytes);
    }
  }

  checkOutputBytes(bytes: number): void {
    if (this.limits.maxOutputBytes !== undefined && bytes > this.limits.maxOutputBytes) {
      throw new MediaLimitExceededError("maxOutputBytes", this.limits.maxOutputBytes, bytes);
    }
  }

  allocateMemory(bytes: number): void {
    this.allocatedBytes += bytes;
    if (this.allocatedBytes > this.peakAllocatedBytes) {
      this.peakAllocatedBytes = this.allocatedBytes;
    }
    if (this.limits.maxMemoryBytes !== undefined && this.allocatedBytes > this.limits.maxMemoryBytes) {
      throw new MediaLimitExceededError(
        "maxMemoryBytes",
        this.limits.maxMemoryBytes,
        this.allocatedBytes
      );
    }
  }

  releaseMemory(bytes: number): void {
    this.allocatedBytes = Math.max(0, this.allocatedBytes - bytes);
  }

  recordFrame(width: number, height: number): void {
    const pixels = width * height;
    if (this.limits.maxPixelsPerFrame !== undefined && pixels > this.limits.maxPixelsPerFrame) {
      throw new MediaLimitExceededError("maxPixelsPerFrame", this.limits.maxPixelsPerFrame, pixels);
    }
    this.decodedFrames += 1;
    if (this.limits.maxFrames !== undefined && this.decodedFrames > this.limits.maxFrames) {
      throw new MediaLimitExceededError("maxFrames", this.limits.maxFrames, this.decodedFrames);
    }
    this.checkCpu();
  }

  checkStreams(count: number): void {
    if (this.limits.maxStreams !== undefined && count > this.limits.maxStreams) {
      throw new MediaLimitExceededError("maxStreams", this.limits.maxStreams, count);
    }
  }

  checkSamples(count: number): void {
    if (this.limits.maxSamplesPerTrack !== undefined && count > this.limits.maxSamplesPerTrack) {
      throw new MediaLimitExceededError("maxSamplesPerTrack", this.limits.maxSamplesPerTrack, count);
    }
  }

  checkDuration(seconds: number): void {
    if (this.limits.maxDurationSeconds !== undefined && seconds > this.limits.maxDurationSeconds) {
      throw new MediaLimitExceededError(
        "maxDurationSeconds",
        this.limits.maxDurationSeconds,
        seconds
      );
    }
  }

  checkConcatInputs(count: number): void {
    if (this.limits.maxConcatInputs !== undefined && count > this.limits.maxConcatInputs) {
      throw new MediaLimitExceededError("maxConcatInputs", this.limits.maxConcatInputs, count);
    }
  }

  checkBoxDepth(depth: number): void {
    if (this.limits.maxBoxDepth !== undefined && depth > this.limits.maxBoxDepth) {
      throw new MediaLimitExceededError("maxBoxDepth", this.limits.maxBoxDepth, depth);
    }
  }

  getStats(): {
    currentMemoryBytes: number;
    peakMemoryBytes: number;
    decodedFrames: number;
    elapsedMs: number;
  } {
    return {
      currentMemoryBytes: this.allocatedBytes,
      peakMemoryBytes: this.peakAllocatedBytes,
      decodedFrames: this.decodedFrames,
      elapsedMs: Date.now() - this.startTimeMs
    };
  }
}

export type MediaTrackType = "video" | "audio" | "subtitle" | "data";

export interface MediaVideoFrame {
  readonly native?: NativeVideoPixels;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array; // RGBA 4 bytes per pixel
  readonly ptsSeconds: number;
  readonly durationSeconds: number;
  readonly keyframe: boolean;
}

export interface MediaAudioData {
  /** WAVE speaker-position mask; absent or zero means an unspecified layout. */
  readonly channelMask?: number | undefined;
  readonly sampleRate: number;
  readonly channels: number;
  readonly channelData: readonly (Float32Array | Float64Array)[];
  readonly startSeconds?: number | undefined;
}

export interface MediaSample {
  /** Encoded Matroska BlockAdditions payload, including auxiliary alpha packets. */
  readonly blockAdditions?: Uint8Array;
  /** WebVTT packet side data, separate from the caption payload. */
  readonly webvtt?: { readonly identifier: string; readonly settings: string } | undefined;
  /** Decoder priming and trailing padding, in PCM samples per channel. */
  readonly skipSamples?: number;
  readonly discardPadding?: number;
  /** Matroska DiscardPadding in nanoseconds; negative values trim the beginning. */
  readonly discardPaddingNs?: number;
  /** Absolute source file offset when the sample was parsed from a container. */
  readonly offset?: number;
  readonly data: Uint8Array;
  readonly dts: number; // in track timescale units
  readonly pts: number; // in track timescale units (dts + cts)
  readonly cts: number; // composition offset (pts - dts)
  readonly duration: number; // in track timescale units
  readonly size: number;
  readonly isKeyframe: boolean;
  readonly sampleDescriptionIndex: number; // 1-based index into track codecDescriptions
}

export interface Mp4AvcCConfig {
  readonly configurationVersion: number;
  readonly profileIdc: number;
  readonly profileCompatibility: number;
  readonly levelIdc: number;
  readonly lengthSizeMinusOne: number;
  readonly sps: readonly Uint8Array[];
  readonly pps: readonly Uint8Array[];
  readonly chromaFormatIdc?: number | undefined;
  readonly bitDepthLumaMinus8?: number | undefined;
  readonly bitDepthChromaMinus8?: number | undefined;
  readonly rawBytes: Uint8Array;
}

export interface Mp4HvcCConfig {
  readonly configurationVersion: number;
  readonly generalProfileSpace: number;
  readonly generalTierFlag: number;
  readonly generalProfileIdc: number;
  readonly generalLevelIdc: number;
  readonly chromaFormatIdc: number;
  readonly bitDepthLumaMinus8: number;
  readonly bitDepthChromaMinus8: number;
  readonly lengthSizeMinusOne: number;
  readonly naluArrays: readonly {
    readonly arrayCompleteness: number;
    readonly nalUnitType: number;
    readonly nalUnits: readonly Uint8Array[];
  }[];
  readonly rawBytes: Uint8Array;
}

export interface Mp4Av1CConfig {
  readonly seqProfile: number;
  readonly seqLevelIdx0: number;
  readonly seqTier0: number;
  readonly highBitdepth: boolean;
  readonly twelveBit: boolean;
  readonly monochrome: boolean;
  readonly chromaSubsamplingX: number;
  readonly chromaSubsamplingY: number;
  readonly configOBUs: Uint8Array;
  readonly rawBytes: Uint8Array;
}

export interface Mp4VpcCConfig {
  readonly profile: number;
  readonly level: number;
  readonly bitDepth: number;
  readonly chromaSubsampling: number;
  readonly videoFullRangeFlag: boolean;
  readonly colourPrimaries: number;
  readonly transferCharacteristics: number;
  readonly matrixCoefficients: number;
  readonly rawBytes: Uint8Array;
}

export interface Mp4AudioSpecificConfig {
  readonly objectTypeIndication: number;
  readonly audioObjectType: number;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly maxBitrate: number;
  readonly avgBitrate: number;
  readonly decoderSpecificInfo: Uint8Array;
  readonly decoderSpecificInfoSize?: number | undefined;
  readonly rawEsdsBytes: Uint8Array;
}

export interface Mp4OpusConfig {
  readonly version: number;
  readonly outputChannelCount: number;
  readonly preSkip: number;
  readonly inputSampleRate: number;
  readonly outputGain: number;
  readonly channelMappingFamily: number;
  readonly rawBytes: Uint8Array;
}

export interface MediaCodecDescription {
  readonly formatFourCC: string; // e.g. 'avc1', 'hvc1', 'av01', 'vp09', 'mp4a', 'Opus', 'fLaC', 'alac', 'jpeg', 'tx3g'
  readonly codecName: string; // e.g. 'h264', 'hevc', 'av1', 'vp9', 'aac', 'opus', 'flac', 'alac', 'mjpeg', 'mov_text'
  readonly mimeCodecString?: string | undefined;
  readonly codecTagString?: string | undefined;
  readonly compressorName?: string | undefined;
  readonly extradataSize?: number | undefined;
  readonly profile?: string | undefined;
  readonly level?: number | undefined;
  readonly maxNumReorderFrames?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  /** Matroska video AlphaMode. */
  readonly alphaMode?: number | undefined;
  readonly pixFmt?: string | undefined;
  readonly fieldOrder?: "progressive" | "unknown" | "tt" | "bb" | undefined;
  readonly h264PictureTiming?: { readonly delayBits: number; readonly nalLengthSize: number } | undefined;
  readonly chromaLocation?: string | undefined;
  readonly nalLengthSize?: number | undefined;
  readonly bitDepthLuma?: number | undefined;
  readonly colorSpace?: string | undefined;
  readonly colorRange?: string | undefined;
  readonly sarWidth?: number | undefined;
  readonly sarHeight?: number | undefined;
  readonly sampleRate?: number | undefined;
  readonly channels?: number | undefined;
  readonly bitsPerSample?: number | undefined;
  readonly avcC?: Mp4AvcCConfig | undefined;
  readonly hvcC?: Mp4HvcCConfig | undefined;
  readonly av1C?: Mp4Av1CConfig | undefined;
  readonly vpcC?: Mp4VpcCConfig | undefined;
  readonly esds?: Mp4AudioSpecificConfig | undefined;
  readonly dOps?: Mp4OpusConfig | undefined;
  readonly extraData?: Uint8Array | undefined;
  /** Matroska StereoMode layout value, retained for stream copy. */
  readonly stereoMode?: number | undefined;
  /** Matroska Colour element payload, retained verbatim for stream copy. */
  readonly rawMkvColourBytes?: Uint8Array | undefined;
  readonly rawWavFormatBytes?: Uint8Array | undefined;
  readonly rawWavFactBytes?: Uint8Array | undefined;
  readonly rawStsdEntryBytes?: Uint8Array | undefined;
}

export interface Mp4EditListEntry {
  readonly segmentDuration: number; // in movie header (mvhd) timescale
  readonly mediaTime: number; // in track media (mdhd) timescale (-1 for empty edit / delay)
  readonly mediaRateInteger: number;
  readonly mediaRateFraction: number;
}

export interface MediaTrack {
  readonly id: number;
  readonly type: MediaTrackType;
  readonly handlerType: string; // 'vide', 'soun', 'sbtl', 'text', 'meta'
  readonly handlerName?: string | undefined;
  readonly timescale: number;
  readonly duration: number; // in track timescale
  /** Matroska decoder delay and seek preroll, in nanoseconds. */
  readonly codecDelayNs?: number | undefined;
  /** Matroska encoded default frame duration, in nanoseconds. */
  readonly defaultDurationNs?: number | undefined;
  readonly seekPreRollNs?: number | undefined;
  readonly language: string; // e.g. 'und', 'eng'
  readonly enabled: boolean;
  readonly disposition?: Readonly<Record<string, number>> | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly rotation?: number | undefined; // 0, 90, 180, 270
  readonly matrix?: readonly number[] | undefined; // 9-element 3x3 display matrix
  readonly volume?: number | undefined; // 0.0 .. 1.0
  readonly codecDescriptions: readonly MediaCodecDescription[];
  readonly editList?: readonly Mp4EditListEntry[] | undefined;
  /** Sample count declared by the MP4 sample table, excluding fragments. */
  readonly declaredSampleCount?: number | undefined;
  readonly samples: readonly MediaSample[];
  readonly metadata?: Readonly<Record<string, string>> | undefined;
  // Decoded / high-level stream payloads when loaded from image/audio/synthetic ASTs
  /** Raw GIF application-extension loop count: zero is infinite; absent means one pass. */
  readonly gifLoop?: number | undefined;
  readonly decodedVideoFrames?: readonly MediaVideoFrame[] | undefined;
  readonly decodedAudio?: MediaAudioData | undefined;
  /** First demux failure and its timestamp in track ticks. */
  readonly demuxError?: { readonly message: string; readonly timestamp: number };
  /** Recoverable errors encountered while decoding this track. */
  readonly decodeErrors?: readonly string[] | undefined;
}

export interface Mp4MetadataTags {
  readonly title?: string | undefined;
  readonly artist?: string | undefined;
  readonly albumArtist?: string | undefined;
  readonly album?: string | undefined;
  readonly date?: string | undefined;
  readonly comment?: string | undefined;
  readonly genre?: string | undefined;
  readonly encoder?: string | undefined;
  readonly trackNumber?: string | undefined;
  readonly discNumber?: string | undefined;
  readonly description?: string | undefined;
  readonly copyright?: string | undefined;
  readonly coverArt?: {
    readonly mimeType: "image/jpeg" | "image/png";
    readonly data: Uint8Array;
  } | undefined;
  readonly custom?: Readonly<Record<string, string>> | undefined;
}

export interface Mp4Chapter {
  /** Original chapter tags, when available, including an explicitly empty title. */
  readonly tags?: Readonly<Record<string, string>>;
  readonly timeBase?: { readonly numerator: number; readonly denominator: number };
  readonly id: number;
  readonly timescale?: number;
  readonly startTimeSeconds: number;
  readonly endTimeSeconds: number;
  readonly title: string;
}

export interface Mp4Box {
  readonly type: string;
  readonly offset: number;
  readonly size: number;
  readonly headerSize: number;
  readonly uuid?: Uint8Array | undefined;
  readonly payload: Uint8Array;
  readonly children?: readonly Mp4Box[] | undefined;
}

export interface MediaAttachment {
  readonly tags: Readonly<Record<string, string>>;
  readonly data: Uint8Array;
  readonly size: number;
}

export interface MediaDocument {
  readonly containerFormat: string; // 'mp4', 'mov', 'matroska', 'webm', 'mpegts', 'avi', 'flv', 'wav', 'mp3', 'flac', 'ogg', 'aac', 'gif', 'webp', 'image2', 'yuv4mpegpipe'
  readonly majorBrand?: string | undefined;
  readonly minorVersion?: number | undefined;
  readonly compatibleBrands?: readonly string[] | undefined;
  readonly timescale: number;
  readonly duration: number; // in document timescale
  readonly durationSeconds: number;
  readonly creationTime?: number | undefined;
  readonly modificationTime?: number | undefined;
  readonly isFragmented?: boolean | undefined;
  readonly faststart?: boolean | undefined;
  readonly attachments?: readonly MediaAttachment[] | undefined;
  readonly tracks: readonly MediaTrack[];
  readonly metadata: Mp4MetadataTags;
  readonly chapters?: readonly Mp4Chapter[] | undefined;
  readonly boxes?: readonly Mp4Box[] | undefined;
  readonly byteLength?: number | undefined;
}

export type Mp4Document = MediaDocument;

export interface MediaProbeStream {
  readonly index: number;
  readonly id?: string | undefined;
  readonly codec_name?: string | undefined;
  readonly codec_long_name?: string | undefined;
  readonly mime_codec_string?: string | undefined;
  readonly profile?: string | undefined;
  readonly codec_type: MediaTrackType | "attachment";
  readonly codec_tag_string: string;
  readonly extradata_size?: number | undefined;
  readonly codec_tag: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly coded_width?: number | undefined;
  readonly coded_height?: number | undefined;
  readonly has_b_frames?: number | undefined;
  readonly sample_aspect_ratio?: string | undefined;
  readonly display_aspect_ratio?: string | undefined;
  readonly pix_fmt?: string | undefined;
  readonly level?: number | undefined;
  readonly color_range?: string | undefined;
  readonly field_order?: string | undefined;
  readonly color_space?: string | undefined;
  readonly chroma_location?: string | undefined;
  readonly is_avc?: string | undefined;
  readonly nal_length_size?: string | undefined;
  readonly bits_per_raw_sample?: string | undefined;
  readonly sample_fmt?: string | undefined;
  readonly sample_rate?: string | undefined;
  readonly initial_padding?: number | undefined;
  readonly channels?: number | undefined;
  readonly channel_layout?: string | undefined;
  readonly bits_per_sample?: number | undefined;
  readonly r_frame_rate: string;
  readonly avg_frame_rate: string;
  readonly time_base: string;
  readonly start_pts: number;
  readonly start_time: string;
  readonly duration_ts?: number | undefined;
  readonly duration?: string | undefined;
  readonly bit_rate?: string | undefined;
  readonly nb_frames?: string | undefined;
  readonly nb_read_packets?: string | undefined;
  readonly nb_read_frames?: string | undefined;
  readonly disposition: Readonly<Record<string, number>>;
  readonly tags?: Readonly<Record<string, string>> | undefined;
  readonly side_data_list?: readonly Readonly<Record<string, unknown>>[] | undefined;
}

export interface MediaProbeFormat {
  readonly filename: string;
  readonly nb_streams: number;
  readonly nb_programs: number;
  readonly nb_stream_groups: number;
  readonly format_name: string;
  readonly format_long_name: string;
  readonly start_time: string;
  readonly duration: string;
  readonly size: string;
  readonly bit_rate: string;
  readonly probe_score: number;
  readonly tags?: Readonly<Record<string, string>> | undefined;
}

export interface MediaProbePacket {
  readonly codec_type: MediaTrackType;
  readonly stream_index: number;
  readonly pts: number;
  readonly pts_time: string;
  readonly dts: number;
  readonly dts_time: string;
  readonly duration: number;
  readonly duration_time: string;
  readonly size: string;
  readonly pos: string;
  readonly flags: string;
  readonly side_data_list?: readonly Readonly<Record<string, unknown>>[] | undefined;
}

export interface MediaProbeFrame {
  readonly media_type: MediaTrackType;
  readonly stream_index: number;
  readonly key_frame?: number;
  readonly pts: number;
  readonly pts_time: string;
  readonly pkt_dts?: number;
  readonly pkt_dts_time?: string;
  readonly best_effort_timestamp?: number;
  readonly best_effort_timestamp_time?: string;
  readonly duration?: number;
  readonly duration_time?: string;
  readonly pkt_duration?: number;
  readonly pkt_duration_time?: string;
  readonly pkt_size?: string;
  readonly format?: number;
  readonly start_display_time?: number;
  readonly end_display_time?: number;
  readonly num_rects?: number;
  readonly pkt_pos?: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly pix_fmt?: string | undefined;
  readonly pict_type?: string | undefined;
  readonly sample_fmt?: string | undefined;
  readonly nb_samples?: number | undefined;
  readonly channels?: number | undefined;
  readonly channel_layout?: string | undefined;
}

export interface MediaProbeResult {
  readonly streams: readonly MediaProbeStream[];
  readonly format: MediaProbeFormat;
  readonly chapters: readonly {
    readonly id: number;
    readonly time_base: string;
    readonly start: number;
    readonly start_time: string;
    readonly end: number;
    readonly end_time: string;
    readonly tags: Readonly<Record<string, string>>;
  }[];
  readonly packets?: readonly MediaProbePacket[] | undefined;
  readonly frames?: readonly MediaProbeFrame[] | undefined;
}

/** Probe descriptors without materializing potentially large packet/frame collections. */
export type MediaProbeRecords = Omit<MediaProbeResult, "packets" | "frames"> & {
  readonly packets?: Iterable<MediaProbePacket> | undefined;
  readonly frames?: Iterable<MediaProbeFrame> | undefined;
};

/** Replayable bounded string chunks. The caller keeps backing alive through all reads.
 * CSV quoting may read a field twice. Each invocation must return the same text.
 */
export interface MediaProbeText {
  readonly kind: 'text';
  chunks(): Iterable<string> | AsyncIterable<string>;
}
export type MediaProbeSourceTags = Readonly<Record<string, string | MediaProbeText>>;
export type MediaProbeSourceStream = Omit<MediaProbeStream, 'tags'> & { readonly tags?: MediaProbeSourceTags | undefined };
export type MediaProbeSourceFormat = Omit<MediaProbeFormat, 'tags'> & { readonly tags?: MediaProbeSourceTags | undefined };
export type MediaProbeSourceChapter = Omit<MediaProbeResult['chapters'][number], 'tags'> & { readonly tags: MediaProbeSourceTags };

/** Caller-backed, one-shot record sources. Consume before retiring the input source. */
export type MediaProbeSourceRecords = Omit<MediaProbeResult, "format" | "streams" | "chapters" | "packets" | "frames"> & {
  /** Retire plugin-owned backing after all requested records, including unselected sections. */
  readonly close?: () => Promise<void>;
  readonly format: MediaProbeSourceFormat;
  readonly streams: Iterable<MediaProbeSourceStream> | AsyncIterable<MediaProbeSourceStream>;
  readonly chapters: Iterable<MediaProbeSourceChapter> | AsyncIterable<MediaProbeSourceChapter>;
  readonly packets?: Iterable<MediaProbePacket> | AsyncIterable<MediaProbePacket> | undefined;
  readonly frames?: Iterable<MediaProbeFrame> | AsyncIterable<MediaProbeFrame> | undefined;
};

export interface MediaSourceProbeOptions extends ParseMediaOptions {
  readonly signal?: AbortSignal;
  readonly showPackets?: boolean;
  readonly showFrames?: boolean;
}

export interface ParseMediaOptions {
  /** Stream parameters for explicitly selected headerless audio formats. */
  readonly sampleRate?: number | undefined;
  readonly channels?: number | undefined;
  /** Resolve a manifest-relative segment URI synchronously from caller-owned storage. */
  readonly resolveResource?: ((uri: string) => Uint8Array) | undefined;
  readonly filename?: string | undefined;
  readonly limits?: MediaResourceLimits | undefined;
  readonly budget?: MediaBudgetTracker | undefined;
  readonly decodeFrames?: boolean | undefined;
  readonly decodeAudio?: boolean | undefined;
}

export interface SerializeMediaOptions {
  /** Whether WAV output can finalize RIFF and data lengths (default: true). */
  readonly seekable?: boolean | undefined;
  /** GIF repeat count: -1 omits the extension, 0 loops forever (default), 1–65535 repeats. */
  readonly gifLoop?: number | undefined;
  /** GIF encoder flags: bit 0 crops frames, bit 1 makes unchanged pixels transparent. */
  readonly gifFlags?: number | undefined;
  readonly globalPalette?: boolean | undefined;
  /** Write a Broadcast Wave bext chunk for WAV output (disabled by default). */
  readonly writeBext?: boolean | undefined;
  /** WAV RF64 mode (default: never); auto reserves space for the ds64 chunk. */
  readonly rf64?: "always" | "auto" | "never" | undefined;
  /** Write a WAV peak envelope from 16-bit PCM (default: off). */
  readonly writePeak?: "off" | "on" | "only" | undefined;
  /** WAV peak block size in frames (0 through 65536, default: 256; 0 omits the envelope). */
  readonly peakBlockSize?: number | undefined;
  /** WAV peak value width in bytes (1 or 2, default: 2). */
  readonly peakFormat?: number | undefined;
  /** WAV peak points per value (1 or 2, default: 2). */
  readonly peakPpv?: number | undefined;
  /** First Ogg logical stream serial number (0 through 2147483647). */
  readonly serialOffset?: number | undefined;
  /** Ogg Opus copy and Opus/Vorbis encoding page target in microseconds (default: 1000000). */
  readonly pageDuration?: number | undefined;
  /** Explicit encoder sample format (FLAC supports s16 and s32). */
  readonly sampleFormat?: string | undefined;
  /** FLAC samples per frame, 16–65535; 0 selects the default (2048). */
  readonly frameSize?: number | undefined;
  /** FLAC compression effort, 0–12; -1 selects the default. */
  readonly compressionLevel?: number | undefined;
  /** FLAC predictor algorithm; LPC modes use a bounded first-order fit. */
  readonly lpcType?: string | undefined;
  /** FLAC: include the stream marker and metadata blocks (default: true). */
  readonly writeHeader?: boolean | undefined;
  /** MP3: write Xing counts and gapless timing (default: true). */
  readonly writeXing?: boolean | undefined;
  /** DASH: emit master.m3u8 and per-representation HLS playlists using the same fragments. */
  readonly hlsPlaylist?: boolean | undefined;
  /** Maximum DASH timeline/list segments per representation; 0 retains all (default). */
  readonly windowSize?: number | undefined;
  /** Target DASH segment duration in seconds (default: 5); video cuts at keyframes. */
  readonly segmentDuration?: number | undefined;
  /** DASH fragment subdivision within each media segment (default: none). */
  readonly fragmentType?: "none" | "every_frame" | undefined;
  /** DASH: combine each representation into one indexed MP4 resource. */
  readonly singleFile?: boolean | undefined;
  /** DASH single-file resource template; defaults to stream$RepresentationID$.mp4. */
  readonly singleFileName?: string | undefined;
  /** Use DASH SegmentTemplate (default: true); false emits explicit SegmentList references. */
  readonly useTemplate?: boolean | undefined;
  /** Use DASH SegmentTimeline (default: true); false uses fixed-duration templates. */
  readonly useTimeline?: boolean | undefined;
  /** FFmpeg DASH adaptation-set mapping, e.g. id=0,streams=a id=1,streams=v. */
  readonly adaptationSets?: string | undefined;
  /** DASH initialization and media resource naming templates. */
  readonly initSegmentName?: string | undefined;
  readonly mediaSegmentName?: string | undefined;
  /** Audio codec selection for containers with multiple encoders (e.g. Ogg). */
  readonly audioCodec?: string | undefined;
  readonly videoCodec?: string | undefined;
  readonly format?: string | undefined;
  readonly faststart?: boolean | undefined;
  readonly fragmented?: boolean | undefined;
  readonly id3v2Version?: 0 | 3 | 4 | undefined;
  readonly writeId3v1?: boolean | undefined;
  /** FLAC metadata padding bytes; -1 selects 8192, zero disables padding. */
  readonly metadataHeaderPadding?: number | undefined;
  /** GIF final frame delay in centiseconds; -1 preserves the source delay. */
  readonly finalDelay?: number | undefined;
  readonly majorBrand?: string | undefined;
  readonly compatibleBrands?: readonly string[] | undefined;
  readonly metadata?: Mp4MetadataTags | undefined;
  readonly limits?: MediaResourceLimits | undefined;
  readonly budget?: MediaBudgetTracker | undefined;
  readonly fps?: number | undefined;
  readonly videoBitrate?: number | undefined;
  readonly audioBitrate?: number | undefined;
}

export interface ConcatMediaOptions {
  /** Segment timeline starts; decoded PCM stays in input order without padding or truncation. */
  readonly startTimesSeconds?: readonly number[] | undefined;
  readonly faststart?: boolean | undefined;
  readonly normalizeTimescale?: boolean | undefined;
  readonly alignTrackDurations?: boolean | undefined;
  readonly metadata?: Mp4MetadataTags | undefined;
  readonly limits?: MediaResourceLimits | undefined;
  readonly budget?: MediaBudgetTracker | undefined;
}

export interface SliceMediaOptions {
  readonly startSeconds?: number | undefined;
  readonly endSeconds?: number | undefined;
  readonly durationSeconds?: number | undefined;
  /** Preserve decode preroll using MP4 edit lists (default true). False cuts samples without preroll. */
  readonly useEditList?: boolean | undefined;
  readonly resetTimestamps?: boolean | undefined;
  readonly limits?: MediaResourceLimits | undefined;
  readonly budget?: MediaBudgetTracker | undefined;
}

export interface MuxMediaOptions {
  readonly faststart?: boolean | undefined;
  readonly stripAudio?: boolean | undefined;
  readonly stripVideo?: boolean | undefined;
  readonly stripSubtitles?: boolean | undefined;
  readonly shortest?: boolean | undefined;
  readonly rotation?: number | undefined;
  readonly metadata?: Mp4MetadataTags | undefined;
  readonly limits?: MediaResourceLimits | undefined;
  readonly budget?: MediaBudgetTracker | undefined;
}

/** Borrowed random-access bytes. The adapter owns source lifetime and filesystem authority. */
export interface MediaProbeSource {
  readonly size: number;
  /** Return at most length bytes; short nonempty reads are supported. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/**
 * Modular AST Plugin Contract consumed by `ffmpeg` and `ffprobe`.
 * `ffmpeg` and `ffprobe` inspect the registered `MediaAstPlugin` instances
 * to decide which container formats, extensions, codecs, demuxers, and muxers
 * are supported at runtime.
 */
export interface MediaAstPlugin {
  readonly id: string;
  readonly formatName: string; // e.g. 'mp4', 'mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm', 'mpegts', 'avi', 'flv'
  readonly formatLongName: string;
  readonly extensions: readonly string[];
  readonly mimeTypes: readonly string[];
  readonly canDemux: boolean;
  readonly canMux: boolean;
  readonly supportedVideoCodecs: readonly string[];
  readonly supportedAudioCodecs: readonly string[];
  readonly supportedSubtitleCodecs?: readonly string[] | undefined;
  detect(bytes: Uint8Array, filename?: string): boolean;
  parse(bytes: Uint8Array, options?: ParseMediaOptions): MediaDocument;
  serialize(doc: MediaDocument, options?: SerializeMediaOptions): Uint8Array;
  probe(bytes: Uint8Array, options?: ParseMediaOptions & { showPackets?: boolean; showFrames?: boolean }): MediaProbeResult;
  /** Lazy caller-backed records; source remains alive through complete enumeration. */
  probeRecords?(source: MediaProbeSource, options?: MediaSourceProbeOptions): Promise<MediaProbeSourceRecords>;
  /** Optional bounded range path; packet/frame descriptors may be lazy iterables. */
  probeMetadata?(source: MediaProbeSource, options?: MediaSourceProbeOptions): Promise<MediaProbeRecords>;
  /** Optional bounded sequential metadata path; consumes input through EOF. */
  probeMetadataStream?(source: AsyncIterable<Uint8Array>, options?: MediaSourceProbeOptions): Promise<MediaProbeRecords>;
  concat?(docs: readonly MediaDocument[], options?: ConcatMediaOptions): MediaDocument;
  slice?(doc: MediaDocument, options?: SliceMediaOptions): MediaDocument;
}
