/* Owned ABI for x264. No host I/O, assembly, or threads. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "x264.h"

typedef struct {
    uint8_t *data;
    int length;
    double pts, dts;
    int keyframe;
} Packet;

typedef struct {
    Packet packet;
    x264_t *encoder;
    x264_picture_t input;
    int width, height;
} Encoder;

void preset_encoder_free(Encoder *state) {
    if (!state) return;
    if (state->encoder) x264_encoder_close(state->encoder);
    free(state);
}

Encoder *preset_encoder_create(int width, int height, int timescale, int frame_duration, const char *preset, int bframes, int qp, int bitrate, int zero_latency) {
    if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || ((width | height) & 1) || timescale <= 0 || frame_duration <= 0) return NULL;
    x264_param_t options;
    if (x264_param_default_preset(&options, preset, zero_latency ? "zerolatency" : NULL)) return NULL;
    options.i_width = width;
    options.i_height = height;
    options.i_csp = X264_CSP_I420;
    options.i_threads = 1;
    options.i_lookahead_threads = 1;
    options.i_log_level = X264_LOG_NONE;
    options.i_timebase_num = 1;
    options.i_timebase_den = timescale;
    options.i_fps_num = timescale;
    options.i_fps_den = frame_duration;
    options.b_vfr_input = 1;
    options.b_repeat_headers = 1;
    options.b_annexb = 1;
    options.rc.i_rc_method = X264_RC_CRF;
    options.rc.f_rf_constant = 23;
    if (qp >= 0) {
        if (qp > 51) return NULL;
        options.rc.i_rc_method = X264_RC_CQP;
        options.rc.i_qp_constant = qp;
    }
    if (qp < 0 && bitrate > 0) {
        options.rc.i_rc_method = X264_RC_ABR;
        options.rc.i_bitrate = bitrate / 1000;
        if (options.rc.i_bitrate < 1) options.rc.i_bitrate = 1;
    }
    if (bframes >= 0) options.i_bframe = bframes > 16 ? 16 : bframes;
    Encoder *state = calloc(1, sizeof(Encoder));
    if (!state) return NULL;
    state->encoder = x264_encoder_open(&options);
    if (!state->encoder) { preset_encoder_free(state); return NULL; }
    state->width = width;
    state->height = height;
    x264_picture_init(&state->input);
    state->input.img.i_csp = X264_CSP_I420;
    state->input.img.i_plane = 3;
    return state;
}

intptr_t preset_encoder_frame(Encoder *state, uint8_t *pixels, double pts, int keyframe) {
    if (!pixels && !x264_encoder_delayed_frames(state->encoder)) return 0;
    x264_picture_t *input = NULL, output;
    if (pixels) {
        input = &state->input;
        input->i_pts = (int64_t)pts;
        input->i_type = keyframe ? X264_TYPE_IDR : X264_TYPE_AUTO;
        int size = state->width * state->height;
        input->img.plane[0] = pixels;
        input->img.plane[1] = pixels + size;
        input->img.plane[2] = pixels + size + size / 4;
        input->img.i_stride[0] = state->width;
        input->img.i_stride[1] = input->img.i_stride[2] = state->width / 2;
    }
    x264_nal_t *nals;
    int count;
    int length = x264_encoder_encode(state->encoder, &nals, &count, input, &output);
    if (length < 0) return -1;
    if (!length) return 0;
    state->packet = (Packet){nals[0].p_payload, length, (double)output.i_pts, (double)output.i_dts, output.b_keyframe};
    return (intptr_t)&state->packet;
}
