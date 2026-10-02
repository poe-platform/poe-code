/* Owned codec ABI. Upstream libraries retain their own licenses; see vendor/NOTICE.md. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <libavcodec/avcodec.h>
#include <libavutil/imgutils.h>
#include <libavutil/log.h>
#include <libswscale/swscale.h>

typedef struct {
    int width, height;
    uint8_t *rgba;
    int length;
    double pts, duration;
} Picture;

typedef struct {
    AVCodecContext *context;
    AVFrame *frame;
    AVPacket *packet;
    struct SwsContext *scaler;
    uint8_t *rgba;
    size_t capacity;
    Picture picture;
} Decoder;

void decoder_free(Decoder *decoder) {
    if (!decoder) return;
    avcodec_free_context(&decoder->context);
    av_frame_free(&decoder->frame);
    av_packet_free(&decoder->packet);
    sws_freeContext(decoder->scaler);
    av_free(decoder->rgba);
    av_free(decoder);
}

Decoder *decoder_create(const uint8_t *extra, int extra_size, double max_pixels) {
    av_log_set_level(AV_LOG_QUIET);
    Decoder *decoder = av_mallocz(sizeof(Decoder));
    if (!decoder) return NULL;
    const AVCodec *codec = avcodec_find_decoder(AV_CODEC_ID_H264);
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
    return decoder;
failure:
    decoder_free(decoder);
    return NULL;
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
    result = avcodec_send_packet(decoder->context, packet);
    av_packet_unref(packet);
    return result;
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
        frame->format, frame->width, frame->height, AV_PIX_FMT_RGBA, SWS_POINT | SWS_ACCURATE_RND | SWS_FULL_CHR_H_INT, NULL, NULL, NULL);
    if (!decoder->scaler) return AVERROR(ENOMEM);
    const int *coefficients = sws_getCoefficients(frame->colorspace == AVCOL_SPC_UNSPECIFIED ? SWS_CS_DEFAULT : frame->colorspace);
    sws_setColorspaceDetails(decoder->scaler, coefficients, frame->color_range == AVCOL_RANGE_JPEG,
        coefficients, 1, 0, 1 << 16, 1 << 16);
    uint8_t *output[] = { decoder->rgba, NULL, NULL, NULL };
    int strides[] = { frame->width * 4, 0, 0, 0 };
    result = sws_scale(decoder->scaler, (const uint8_t *const *)frame->data,
        frame->linesize, 0, frame->height, output, strides);
    if (result != frame->height) return AVERROR_INVALIDDATA;
    decoder->picture = (Picture){frame->width, frame->height, decoder->rgba, length, (double)frame->pts, (double)frame->duration};
    return (intptr_t)&decoder->picture;
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
