/* Owned codec ABI. Upstream libraries retain their own licenses; see vendor/NOTICE.md. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <libavcodec/avcodec.h>
#include <libavcodec/vorbis_parser.h>
#include <libavutil/imgutils.h>
#include <libavutil/log.h>
#include <libswscale/swscale.h>

typedef struct {
    int width, height;
    uint8_t *rgba;
    int length;
    double pts, duration;
    uint8_t *pixels;
    int pixel_length, format, colorspace, full_range;
} Picture;

typedef struct {
    struct { uint8_t *data; int length, frame_size, delay; } encoded;
    AVCodecContext *context;
    AVVorbisParseContext *vorbis;
    int64_t vorbis_position;
    AVFrame *frame;
    AVPacket *packet;
    struct SwsContext *scaler;
    uint8_t *rgba;
    uint8_t *pixels;
    size_t capacity;
    Picture picture;
    struct { int rate, channels, count; float *data; double pts; } audio;
} Decoder;

void decoder_free(Decoder *decoder) {
    if (!decoder) return;
    av_vorbis_parse_free(&decoder->vorbis);
    avcodec_free_context(&decoder->context);
    av_frame_free(&decoder->frame);
    av_packet_free(&decoder->packet);
    sws_freeContext(decoder->scaler);
    av_free(decoder->rgba);
    av_free(decoder->pixels);
    av_free(decoder);
}

static Decoder *create_decoder(const uint8_t *extra, int extra_size, double max_pixels, enum AVCodecID id) {
    av_log_set_level(AV_LOG_QUIET);
    Decoder *decoder = av_mallocz(sizeof(Decoder));
    if (!decoder) return NULL;
    const AVCodec *codec = avcodec_find_decoder(id);
    decoder->context = avcodec_alloc_context3(codec);
    decoder->frame = av_frame_alloc();
    decoder->packet = av_packet_alloc();
    if (!decoder->context || !decoder->frame || !decoder->packet) goto failure;
    decoder->context->thread_count = 1;
    decoder->context->max_pixels = (int64_t)max_pixels;
    decoder->context->err_recognition = AV_EF_EXPLODE;
    if (extra_size > 0) {
        decoder->context->extradata = av_mallocz(extra_size + AV_INPUT_BUFFER_PADDING_SIZE);
        if (!decoder->context->extradata) goto failure;
        memcpy(decoder->context->extradata, extra, extra_size);
        decoder->context->extradata_size = extra_size;
    }
    if (avcodec_open2(decoder->context, codec, NULL) < 0) goto failure;
    if (id == AV_CODEC_ID_VORBIS) {
        decoder->vorbis = av_vorbis_parse_init(extra, extra_size);
        if (!decoder->vorbis) goto failure;
    }
    return decoder;
failure:
    decoder_free(decoder);
    return NULL;
}

Decoder *decoder_create(const uint8_t *extra, int extra_size, double max_pixels) {
    return create_decoder(extra, extra_size, max_pixels, AV_CODEC_ID_H264);
}

Decoder *audio_decoder_create(int codec, const uint8_t *extra, int extra_size) {
    if (codec != 1 && extra_size <= 0) return NULL;
    return create_decoder(extra, extra_size, 0, codec == 0 ? AV_CODEC_ID_AAC : codec == 1 ? AV_CODEC_ID_MP3 : AV_CODEC_ID_VORBIS);
}

intptr_t audio_decoder_receive(Decoder *decoder) {
    AVFrame *frame = decoder->frame;
    int result = avcodec_receive_frame(decoder->context, frame);
    if (result == AVERROR(EAGAIN) || result == AVERROR_EOF) return 0;
    if (result < 0) return result;
    if (frame->decode_error_flags) return AVERROR_INVALIDDATA;
    int channels = frame->ch_layout.nb_channels;
    if (frame->format != AV_SAMPLE_FMT_FLTP || channels < 1 || channels > 8 ||
        frame->nb_samples <= 0 || frame->nb_samples > 8192) return AVERROR_INVALIDDATA;
    size_t length = channels * frame->nb_samples * sizeof(float);
    if (length > decoder->capacity) {
        uint8_t *allocation = av_realloc(decoder->rgba, length);
        if (!allocation) return AVERROR(ENOMEM);
        decoder->rgba = allocation;
        decoder->capacity = length;
    }
    for (int channel = 0; channel < channels; channel++)
        memcpy(decoder->rgba + channel * frame->nb_samples * sizeof(float),
            frame->extended_data[channel], frame->nb_samples * sizeof(float));
    decoder->audio.rate = frame->sample_rate;
    decoder->audio.channels = channels;
    decoder->audio.count = frame->nb_samples;
    decoder->audio.data = (float *)decoder->rgba;
    decoder->audio.pts = (double)frame->pts;
    return (intptr_t)&decoder->audio;
}

int decoder_send(Decoder *decoder, const uint8_t *data, int length, double pts, double dts, double duration) {
    if (!data) return avcodec_send_packet(decoder->context, NULL);
    AVPacket *packet = decoder->packet;
    av_packet_unref(packet);
    int result = av_new_packet(packet, length);
    if (result < 0) return result;
    memcpy(packet->data, data, length);
    packet->pts = (int64_t)pts;
    packet->dts = (int64_t)dts;
    packet->duration = (int64_t)duration;
    if (decoder->vorbis) {
        int samples = av_vorbis_parse_frame(decoder->vorbis, data, length);
        if (samples < 0) return samples;
        packet->pts = packet->dts = decoder->vorbis_position;
        packet->duration = samples;
        decoder->vorbis_position += samples;
    }
    result = avcodec_send_packet(decoder->context, packet);
    av_packet_unref(packet);
    return result;
}

/* Portable equivalent of FFmpeg's AArch64 unscaled YUV-to-RGBA conversion.
 * It truncates each signed multiply separately, then rounds the final sum.
 * Keep its format/dimension guards: other layouts use libswscale below. */
static int unscaled_rgba(const uint8_t *const planes[], const int strides[],
    int width, int height, int format, const int *coefficients, int full_range, uint8_t *rgba) {
    if (format == AV_PIX_FMT_YUVJ420P) format = AV_PIX_FMT_YUV420P;
    if (format == AV_PIX_FMT_YUVJ422P) format = AV_PIX_FMT_YUV422P;
    if ((format != AV_PIX_FMT_YUV420P && format != AV_PIX_FMT_YUV422P) ||
        (width & 15) || (height & 1)) return 0;
    int chroma[4];
    for (int i = 0; i < 4; i++) {
        int coefficient = i < 2 ? coefficients[i] : -coefficients[i];
        if (full_range) coefficient = coefficient * 224 / 255;
        chroma[i] = (coefficient + 4) >> 3;
    }
    int luma = full_range ? 8192 : ((65536 * 255 / 219 + 4) >> 3);
    int offset = full_range ? 0 : 128;
    for (int row = 0; row < height; row++) {
        int chroma_row = format == AV_PIX_FMT_YUV420P ? row / 2 : row;
        for (int col = 0; col < width; col++) {
            int y = ((planes[0][row * strides[0] + col] * 8 - offset) * luma) >> 15;
            int u = (planes[1][chroma_row * strides[1] + col / 2] - 128) * 8;
            int v = (planes[2][chroma_row * strides[2] + col / 2] - 128) * 8;
            *rgba++ = av_clip_uint8((y + ((v * chroma[0]) >> 15) + 1) >> 1);
            *rgba++ = av_clip_uint8((y + ((u * chroma[2]) >> 15) + ((v * chroma[3]) >> 15) + 1) >> 1);
            *rgba++ = av_clip_uint8((y + ((u * chroma[1]) >> 15) + 1) >> 1);
            *rgba++ = 255;
        }
    }
    return height;
}

/* A positive result points to Picture; zero means more input/end; negative means error. */
intptr_t decoder_receive(Decoder *decoder) {
    AVFrame *frame = decoder->frame;
    int result = avcodec_receive_frame(decoder->context, frame);
    if (result == AVERROR(EAGAIN) || result == AVERROR_EOF) return 0;
    if (result < 0) return result;
    int length = av_image_get_buffer_size(AV_PIX_FMT_RGBA, frame->width, frame->height, 1);
    if (length < 0) return length;
    if ((size_t)length > decoder->capacity) {
        uint8_t *allocation = av_realloc(decoder->rgba, length);
        if (!allocation) return AVERROR(ENOMEM);
        decoder->rgba = allocation;
        decoder->capacity = length;
    }
    decoder->scaler = sws_getCachedContext(decoder->scaler, frame->width, frame->height,
        frame->format, frame->width, frame->height, AV_PIX_FMT_RGBA, SWS_BICUBIC, NULL, NULL, NULL);
    if (!decoder->scaler) return AVERROR(ENOMEM);
    const int *coefficients = sws_getCoefficients(frame->colorspace == AVCOL_SPC_UNSPECIFIED ? SWS_CS_DEFAULT : frame->colorspace);
    sws_setColorspaceDetails(decoder->scaler, coefficients, frame->color_range == AVCOL_RANGE_JPEG,
        coefficients, 1, 0, 1 << 16, 1 << 16);
    uint8_t *output[] = { decoder->rgba, NULL, NULL, NULL };
    int strides[] = { frame->width * 4, 0, 0, 0 };
    result = unscaled_rgba((const uint8_t *const *)frame->data, frame->linesize,
        frame->width, frame->height, frame->format, coefficients, frame->color_range == AVCOL_RANGE_JPEG, decoder->rgba);
    if (!result) result = sws_scale(decoder->scaler, (const uint8_t *const *)frame->data,
        frame->linesize, 0, frame->height, output, strides);
    if (result != frame->height) return AVERROR_INVALIDDATA;
    int pixel_length = av_image_get_buffer_size(frame->format, frame->width, frame->height, 1);
    if (pixel_length < 0) return pixel_length;
    av_freep(&decoder->pixels);
    decoder->pixels = av_mallocz(pixel_length + AV_INPUT_BUFFER_PADDING_SIZE);
    if (!decoder->pixels) return AVERROR(ENOMEM);
    result = av_image_copy_to_buffer(decoder->pixels, pixel_length,
        (const uint8_t *const *)frame->data, frame->linesize, frame->format, frame->width, frame->height, 1);
    if (result < 0) return result;
    decoder->picture = (Picture){frame->width, frame->height, decoder->rgba, length, (double)frame->pts, (double)frame->duration,
        decoder->pixels, pixel_length, frame->format, frame->colorspace, frame->color_range == AVCOL_RANGE_JPEG};
    return (intptr_t)&decoder->picture;
}

/* Packed native pixels remain valid after their decoder has been released. */
int scale_picture(const uint8_t *pixels, int length, int width, int height, int format,
    int colorspace, int full_range, uint8_t *rgba, int target_width, int target_height) {
    int expected = av_image_get_buffer_size(format, width, height, 1);
    if (expected <= 0 || expected != length) return AVERROR_INVALIDDATA;
    uint8_t *planes[4];
    int strides[4];
    if (av_image_fill_arrays(planes, strides, pixels, format, width, height, 1) < 0)
        return AVERROR_INVALIDDATA;
    struct SwsContext *scaler = sws_getContext(width, height, format, target_width, target_height,
        AV_PIX_FMT_RGBA, SWS_BICUBIC, NULL, NULL, NULL);
    if (!scaler) return AVERROR(ENOMEM);
    const int *coefficients = sws_getCoefficients(colorspace == AVCOL_SPC_UNSPECIFIED ? SWS_CS_DEFAULT : colorspace);
    sws_setColorspaceDetails(scaler, coefficients, full_range, coefficients, 1, 0, 1 << 16, 1 << 16);
    uint8_t *output[] = { rgba, NULL, NULL, NULL };
    int output_strides[] = { target_width * 4, 0, 0, 0 };
    int result = width == target_width && height == target_height
        ? unscaled_rgba((const uint8_t *const *)planes, strides, width, height, format, coefficients, full_range, rgba) : 0;
    if (!result) result = sws_scale(scaler, (const uint8_t *const *)planes, strides, 0, height, output, output_strides);
    sws_freeContext(scaler);
    return result == target_height ? 0 : AVERROR_INVALIDDATA;
}

#include <vorbis/vorbisenc.h>
#include <opus/opus.h>

typedef struct {
    const uint8_t *data;
    int length;
    double granule;
} AudioPacket;

typedef struct {
    int codec, channels, initialized;
    vorbis_info info;
    vorbis_comment comment;
    vorbis_dsp_state dsp;
    vorbis_block block;
    ogg_packet headers[3], packet;
    OpusEncoder *opus;
    uint8_t opus_header[19], opus_packet[4000];
    int opus_pending, pre_skip;
    int64_t opus_granule;
    AudioPacket output;
} AudioEncoder;

void audio_free(AudioEncoder *encoder) {
    if (!encoder) return;
    if (encoder->opus) opus_encoder_destroy(encoder->opus);
    if (encoder->codec == 0) {
        if (encoder->initialized) {
            vorbis_block_clear(&encoder->block);
            vorbis_dsp_clear(&encoder->dsp);
        }
        vorbis_comment_clear(&encoder->comment);
        vorbis_info_clear(&encoder->info);
    }
    free(encoder);
}

AudioEncoder *audio_create(int codec, int sample_rate, int channels) {
    AudioEncoder *encoder = calloc(1, sizeof(AudioEncoder));
    if (!encoder) return NULL;
    encoder->codec = codec;
    encoder->channels = channels;
    if (codec == 0) {
        vorbis_info_init(&encoder->info);
        vorbis_comment_init(&encoder->comment);
        if (vorbis_encode_init_vbr(&encoder->info, channels, sample_rate, 0.3f)) goto failure;
        if (vorbis_analysis_init(&encoder->dsp, &encoder->info)) goto failure;
        if (vorbis_block_init(&encoder->dsp, &encoder->block)) {
            vorbis_dsp_clear(&encoder->dsp);
            goto failure;
        }
        encoder->initialized = 1;
        if (vorbis_analysis_headerout(&encoder->dsp, &encoder->comment,
            &encoder->headers[0], &encoder->headers[1], &encoder->headers[2])) goto failure;
    } else if (codec == 1) {
        int error;
        if (sample_rate != 48000 || channels < 1 || channels > 2) goto failure;
        encoder->opus = opus_encoder_create(sample_rate, channels, OPUS_APPLICATION_AUDIO, &error);
        if (!encoder->opus || error != OPUS_OK) goto failure;
        if (opus_encoder_ctl(encoder->opus, OPUS_GET_LOOKAHEAD(&encoder->pre_skip)) != OPUS_OK) goto failure;
        memcpy(encoder->opus_header, "OpusHead", 8);
        encoder->opus_header[8] = 1;
        encoder->opus_header[9] = channels;
        encoder->opus_header[10] = encoder->pre_skip & 255;
        encoder->opus_header[11] = encoder->pre_skip >> 8;
        for (int i = 0; i < 4; i++) encoder->opus_header[12 + i] = (sample_rate >> (8 * i)) & 255;
    } else goto failure;
    return encoder;
failure:
    audio_free(encoder);
    return NULL;
}

intptr_t audio_header(AudioEncoder *encoder, int index) {
    if (encoder->codec == 0) {
        if (index < 0 || index > 2) return 0;
        encoder->output = (AudioPacket){encoder->headers[index].packet, encoder->headers[index].bytes, 0};
    } else {
        if (index != 0) return 0;
        encoder->output = (AudioPacket){encoder->opus_header, 19, encoder->pre_skip};
    }
    return (intptr_t)&encoder->output;
}

int audio_send(AudioEncoder *encoder, const float *interleaved, int count) {
    if (encoder->codec == 0) {
        if (count == 0) return vorbis_analysis_wrote(&encoder->dsp, 0);
        float **buffer = vorbis_analysis_buffer(&encoder->dsp, count);
        if (!buffer) return -1;
        for (int channel = 0; channel < encoder->channels; channel++)
            for (int sample = 0; sample < count; sample++)
                buffer[channel][sample] = interleaved[sample * encoder->channels + channel];
        return vorbis_analysis_wrote(&encoder->dsp, count);
    }
    if (count != 960 || encoder->opus_pending) return -1;
    int bytes = opus_encode_float(encoder->opus, interleaved, count, encoder->opus_packet, sizeof(encoder->opus_packet));
    if (bytes < 0) return bytes;
    encoder->opus_granule += count;
    encoder->output = (AudioPacket){encoder->opus_packet, bytes, (double)encoder->opus_granule};
    encoder->opus_pending = 1;
    return 0;
}

intptr_t audio_receive(AudioEncoder *encoder) {
    if (encoder->codec == 1) {
        if (!encoder->opus_pending) return 0;
        encoder->opus_pending = 0;
        return (intptr_t)&encoder->output;
    }
    for (;;) {
        int result = vorbis_bitrate_flushpacket(&encoder->dsp, &encoder->packet);
        if (result < 0) return result;
        if (result > 0) {
            encoder->output = (AudioPacket){encoder->packet.packet, encoder->packet.bytes, (double)encoder->packet.granulepos};
            return (intptr_t)&encoder->output;
        }
        result = vorbis_analysis_blockout(&encoder->dsp, &encoder->block);
        if (result <= 0) return result;
        if (vorbis_analysis(&encoder->block, NULL) || vorbis_bitrate_addblock(&encoder->block)) return -1;
    }
}

/* AAC and MP3 use the same bounded frame/packet lifecycle as the decoders. */
Decoder *audio_encoder_create(int codec, int sample_rate, int channels) {
    av_log_set_level(AV_LOG_QUIET);
    const AVCodec *implementation = avcodec_find_encoder(codec == 0 ? AV_CODEC_ID_AAC : AV_CODEC_ID_MP3);
    if (!implementation || channels < 1 || channels > 8 || (codec == 1 && channels > 2)) return NULL;
    Decoder *encoder = av_mallocz(sizeof(Decoder));
    if (!encoder) return NULL;
    encoder->context = avcodec_alloc_context3(implementation);
    encoder->frame = av_frame_alloc();
    encoder->packet = av_packet_alloc();
    if (!encoder->context || !encoder->frame || !encoder->packet) goto failure;
    encoder->context->sample_fmt = AV_SAMPLE_FMT_FLTP;
    encoder->context->sample_rate = sample_rate;
    encoder->context->time_base = (AVRational){1, sample_rate};
    av_channel_layout_default(&encoder->context->ch_layout, channels);
    if (avcodec_open2(encoder->context, implementation, NULL) < 0) goto failure;
    return encoder;
failure:
    decoder_free(encoder);
    return NULL;
}

intptr_t audio_encoder_config(Decoder *encoder) {
    encoder->encoded.data = encoder->context->extradata;
    encoder->encoded.length = encoder->context->extradata_size;
    encoder->encoded.frame_size = encoder->context->frame_size;
    encoder->encoded.delay = encoder->context->initial_padding;
    return (intptr_t)&encoder->encoded;
}

int audio_encoder_send(Decoder *encoder, const float *planar, int count) {
    if (!planar) return avcodec_send_frame(encoder->context, NULL);
    if (count <= 0 || count > encoder->context->frame_size) return AVERROR(EINVAL);
    AVFrame *frame = encoder->frame;
    av_frame_unref(frame);
    frame->format = encoder->context->sample_fmt;
    frame->sample_rate = encoder->context->sample_rate;
    av_channel_layout_copy(&frame->ch_layout, &encoder->context->ch_layout);
    frame->nb_samples = count;
    frame->pts = encoder->vorbis_position;
    if (av_frame_get_buffer(frame, 0) < 0) return AVERROR(ENOMEM);
    for (int channel = 0; channel < frame->ch_layout.nb_channels; channel++)
        memcpy(frame->extended_data[channel], planar + channel * count, count * sizeof(float));
    encoder->vorbis_position += count;
    return avcodec_send_frame(encoder->context, frame);
}

intptr_t audio_encoder_receive(Decoder *encoder) {
    av_packet_unref(encoder->packet);
    int result = avcodec_receive_packet(encoder->context, encoder->packet);
    if (result == AVERROR(EAGAIN) || result == AVERROR_EOF) return 0;
    if (result < 0) return result;
    encoder->encoded.data = encoder->packet->data;
    encoder->encoded.length = encoder->packet->size;
    return (intptr_t)&encoder->encoded;
}
