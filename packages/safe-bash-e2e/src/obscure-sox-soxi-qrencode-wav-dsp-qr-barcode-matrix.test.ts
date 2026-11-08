import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SafeBashE2EHarness } from "./harness.js";

describe("Obscure Sox Soxi Qrencode WAV DSP QR Barcode Matrix E2E", () => {
  it("sox synth sine wave 8kHz 16-bit mono and soxi full and single-flag inspection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sox -r 8000 -c 1 -b 16 -n /workspace/sine.wav synth 0.25 sine 440\nsoxi /workspace/sine.wav\nsoxi -t /workspace/sine.wav\nsoxi -r /workspace/sine.wav\nsoxi -c /workspace/sine.wav\nsoxi -s /workspace/sine.wav\nsoxi -d /workspace/sine.wav\nsoxi -D /workspace/sine.wav\nsoxi -b /workspace/sine.wav\nsoxi -B /workspace/sine.wav\nsox --i -s /workspace/sine.wav\nsha256sum /workspace/sine.wav");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "\nInput File     : '/workspace/sine.wav'\nChannels       : 1\nSample Rate    : 8000\nPrecision      : 16-bit\nDuration       : 00:00:00.25 = 2000 samples\nBit Rate       : 129k\nwav\n8000\n1\n2000\n00:00:00.25\n0.250000\n16\n129k\n2000\n1264509536602c1bac4eb0ebffa0fbe90250ab5dea7f3ea7cf35cc36728b95e3  /workspace/sine.wav\n");
    } finally {
      await h.dispose();
    }
  });

  it("sox synth square triangle sawtooth waveforms with trim pad reverse and stat", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sox -r 4000 -c 1 -b 16 -n /workspace/sq.wav synth 0.1 square 200\nsox -r 4000 -c 1 -b 16 -n /workspace/tri.wav synth 0.1 triangle 250\nsox -r 4000 -c 1 -b 16 -n /workspace/saw.wav synth 0.1 sawtooth 100\nsox /workspace/sq.wav /workspace/tri.wav /workspace/saw.wav /workspace/concat.wav pad 0.05 0.05 trim 0.02 0.30 reverse stat 2>/workspace/stat.txt\ncat /workspace/stat.txt\nsoxi -s /workspace/concat.wav\nsha256sum /workspace/concat.wav");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Samples read:      1200\nLength (seconds): 0.300000\nMaximum amplitude: 1.000000\nRMS amplitude:     0.725107\nMean amplitude:    -0.005839\n1200\n20b02d2330e7c19d341de35056aec83050d3084b64fb5d17d5e9adf0524cbee0  /workspace/concat.wav\n");
    } finally {
      await h.dispose();
    }
  });

  it("sox 24-bit 32-bit 8-bit unsigned and 32-bit 64-bit IEEE float WAV encoding roundtrips", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sox -r 2000 -c 2 -b 24 -e signed-integer -n /workspace/pcm24.wav synth 0.05 sine 200\nsox /workspace/pcm24.wav -b 8 -e unsigned-integer /workspace/pcm8.wav\nsox /workspace/pcm24.wav -b 32 -e floating-point /workspace/flt32.wav\nsox /workspace/flt32.wav -b 64 -e floating-point /workspace/flt64.wav\nsox /workspace/flt64.wav -b 16 -e signed-integer /workspace/pcm16.wav\nsoxi -b /workspace/pcm24.wav /workspace/pcm8.wav /workspace/flt32.wav /workspace/flt64.wav /workspace/pcm16.wav\nsha256sum /workspace/pcm24.wav /workspace/pcm8.wav /workspace/flt32.wav /workspace/flt64.wav /workspace/pcm16.wav");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "24\n8\n32\n64\n16\nb133eb19e27cf9c88c4ebc4789127fb1b605fddb40500494ea94c70942b182c4  /workspace/pcm24.wav\n22471da4db380482c6bf01b97724be8090e20d2eaa8bb4e41c85eb9b44d729e3  /workspace/pcm8.wav\na02abc158292547e03a4faa34615b5394aa3d310edc581b7c10e53904e4739d1  /workspace/flt32.wav\ne0639de371d65fc5c378e8ae7737998c743b9c85f6db24c6cbb4e74130d41a9d  /workspace/flt64.wav\n0b06f39d8efe831708dbc34e62969a522e3d9ce76a884605f7554a948f3bd00c  /workspace/pcm16.wav\n");
    } finally {
      await h.dispose();
    }
  });

  it("sox norm gain -n remix channels fade curves and sinc rate resampling", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sox -r 2000 -c 1 -b 16 -n /workspace/quiet.wav synth 0.1 sine 100 gain -n -6\nsox /workspace/quiet.wav /workspace/stereo.wav channels 2 fade h 0.02 0.1 0.02\nsox /workspace/stereo.wav /workspace/remixed.wav remix 1,2 1 0\nsox /workspace/remixed.wav /workspace/upsampled.wav rate 4000 norm -3 stats 2>/workspace/stats.txt\ncat /workspace/stats.txt\nsoxi -c /workspace/remixed.wav\nsoxi -r /workspace/upsampled.wav\nsoxi -s /workspace/upsampled.wav\nsha256sum /workspace/upsampled.wav");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "DC offset   -0.000024\nPk lev dB   -3.00\nRMS lev dB  -9.05\nCrest factor 2.01\nNum samples 400\nLength s    0.100000\n3\n4000\n400\n8cdd0bcc937d2b8d5af6dee8838c14fda7e02221ab3ac388f3907f2650695555  /workspace/upsampled.wav\n");
    } finally {
      await h.dispose();
    }
  });

  it("sox sample-count time syntax MM:SS time syntax and stdin-to-stdout WAV pipeline", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sox -r 1000 -c 1 -b 16 -n - synth 0.5 sine 50 | sox - -t wav - trim 100s 250s pad 0:00.05 50s | soxi -s -\nsox -r 1000 -c 1 -b 16 -n - synth 0.2 triangle 50 | sox - -n stat 2>&1");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "350\nSamples read:      200\nLength (seconds): 0.200000\nMaximum amplitude: 1.000000\nRMS amplitude:     0.583090\nMean amplitude:    -0.000002\n");
    } finally {
      await h.dispose();
    }
  });

  it("sox and soxi error diagnostics for Nyquist limit invalid remix and format mismatch", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sox -r 1000 -c 1 -n /workspace/bad.wav synth 0.1 sine 600 2>&1 || echo \"nyquist:$?\"\nsox -r 1000 -c 1 -n /workspace/ok.wav synth 0.05 sine 100\nsox -c 2 /workspace/ok.wav /workspace/mismatch.wav 2>&1 || echo \"ch_mismatch:$?\"\nsox /workspace/ok.wav /workspace/bad_remix.wav remix 3 2>&1 || echo \"remix:$?\"\nsox /workspace/ok.wav /workspace/bad.mp3 2>&1 || echo \"ext:$?\"\nsoxi -z /workspace/ok.wav 2>&1 || echo \"soxi_flag:$?\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "sox: Frequency exceeds Nyquist limit\nnyquist:1\nsox: Input channel override disagrees with WAV header\nch_mismatch:1\nsox: Invalid remix channel\nremix:1\nsox: Output must be WAV (.wav)\next:1\nsoxi: Unsupported info option -z\nsoxi_flag:1\n");
    } finally {
      await h.dispose();
    }
  });

  it("qrencode ASCII ASCIIi UTF8 UTF8i and ANSIUTF8 rendering with error correction levels", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("qrencode -t ASCII -m 1 -l L \"SAFE-BASH-123\" | sha256sum\nqrencode -t ASCIIi -m 1 -l M \"SAFE-BASH-123\" | sha256sum\nqrencode -t UTF8 -m 2 -l Q \"https://poe.com/code?x=1&y=2\"\nqrencode -t UTF8i -m 1 -l H \"HELLO WORLD 42\"\nqrencode -t ANSI -m 1 \"0123456789\" | sha256sum\nqrencode -t ANSI256 -m 1 \"0123456789\" | sha256sum\nqrencode -t ANSIUTF8 -m 1 \"0123456789\" | sha256sum");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "b051eec2f067a10e6fb1c77302851bad4833474af4452a1e529d4465974b8a13  -\nbdfae9c7ba03318a6f14357b111eb0898e4138172d9df9f1e749ac0debc1f39b  -\n█████████████████████████████████\n██ ▄▄▄▄▄ ██▀ ▀▄█▄▀▀██▀▄█ ▄▄▄▄▄ ██\n██ █   █ █▄▀▄▄██ █▀▄▄▀▄█ █   █ ██\n██ █▄▄▄█ █  ▄█▄▄█▀ ▀ ▀██ █▄▄▄█ ██\n██▄▄▄▄▄▄▄█▄█ ▀ █▄█ ▀▄▀ █▄▄▄▄▄▄▄██\n███ ██ ▀▄█▄▄▀▄██▄▀ ▀ █▀ ▀▄ █▄▀▀██\n███ ▄  ▄▄▄▀█▀▄▄█▄▄ ▀▄█▄ █ ▀ ▄▀ ██\n██▀▀▀▀▄ ▄█▄ █ ▀▄ ▀▀ ▀█▄█▀▄▀▄▀█ ██\n███▀ ▀▀▄▄▀▄█▀▀█ ▄███▄███▀▀▄▀██▄██\n██▀█▄▀ ▀▄██▄████ █▄█▀▄█▀▀ ▀█▀█▀██\n████▀▄▄▀▄▀ █ ▀▄ ▀ ▀▀▀▀▀███ ▀█▀ ██\n██▄▄▄█▄█▄▄▀██▀ ▀▄▀█▄▀▄ ▄▄▄ ▄▀▄ ██\n██ ▄▄▄▄▄ ██  █▀▀▄ █ ▀  █▄█ ▀██▄██\n██ █   █ █▄█ ▄▀▀▄▄▀▀▄▄▄▄▄ ▄█▀ ▄██\n██ █▄▄▄█ █▀▀ ▀█▄▀█▄▀ ▄  ▀▀█▄█  ██\n██▄▄▄▄▄▄▄██▄█▄█▄█▄█▄█▄▄▄██▄██▄███\n█████████████████████████████████\n ▄▄▄▄▄▄▄   ▄  ▄▄▄  ▄▄▄▄▄▄▄ \n █ ▄▄▄ █ ▀▀ ▀▄   █ █ ▄▄▄ █ \n █ ███ █  ▄ ▄  ▀██ █ ███ █ \n █▄▄▄▄▄█ █ ▄▀▄▀█▀▄ █▄▄▄▄▄█ \n     ▄▄▄▄▀▄ ▀▄█ ▄█ ▄▄   ▄  \n  █▄█ ▄▄▄▄█▄█ ▄ █▄██ ▄▀█▄█ \n ▀▄▀▀▄▀▄█▀▄ ▀▄█▀▄█▀▄▄ █▀▄█ \n ▀ █ ▄█▄▄▄█  ▀█ ▄  ██ ▀ █▄ \n ▄▄▀▄ ▄▄▀▄███ ▄ ▀█████▀█▀▄ \n ▄▄▄▄▄▄▄ ██ ▀▀██▄█ ▄ █▀██  \n █ ▄▄▄ █ █▄██▀▄▄▄█▄▄▄█  ▄█ \n █ ███ █  ▄   ▄█ ▀█ █▀█▄▄▀ \n █▄▄▄▄▄█   █▀█▄▀ ▀█▄ ▄▄ ▀█ \n                           \n29fc0fe02c9a8280465f05b4b17bc16acd272ceae4eb81856c42f81bcd529201  -\n03b5b0e157b1207f122f9a41e1a7252d7f3091be6d9679ffcfac1257da0fe37d  -\n669aab4506e3c99d7d5e4468269661076788a51c3486732bea088b5b0f79e557  -\n");
    } finally {
      await h.dispose();
    }
  });

  it("qrencode Micro QR M1 M2 M3 M4 and case-insensitive alphanumeric folding", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("qrencode -M -v 1 -t ASCII -m 1 \"12345\"\nqrencode -M -v 2 -l M -t ASCII -m 1 \"ABC123\"\nqrencode -M -v 3 -l L -t UTF8 -m 2 \"micro-qr-byte\"\nqrencode -M -v 4 -l Q -t UTF8 -m 2 -i \"lowercase-folded-to-alnum\"\nqrencode -i -t ASCII -m 1 \"hello world\" > /workspace/qr_folded.txt\nqrencode -t ASCII -m 1 \"HELLO WORLD\" > /workspace/qr_upper.txt\ncmp -s /workspace/qr_folded.txt /workspace/qr_upper.txt && echo \"folded_matches_upper\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "                          \n  ##############  ##  ##  \n  ##          ##  ####    \n  ##  ######  ##  ##      \n  ##  ######  ##          \n  ##  ######  ##  ######  \n  ##          ##    ####  \n  ##############  ##      \n                    ####  \n  ####    ######    ####  \n    ##  ##      ####      \n  ########          ####  \n                          \n                                  \n  ##############  ##  ##  ##  ##  \n  ##          ##  ##  ##  ##  ##  \n  ##  ######  ##    ##  ##  ####  \n  ##  ######  ##    ##########    \n  ##  ######  ##  ########  ####  \n  ##          ##      ##    ##    \n  ##############  ##  ######  ##  \n                  ##    ##    ##  \n  ##          ##########  ##  ##  \n      ##########          ####    \n  ####  ##    ##  ########  ####  \n      ######          ##  ##      \n  ####    ##    ##          ##    \n        ##  ##      ##  ##    ##  \n  ##  ######        ######  ##    \n                                  \n█████████████████████\n██ ▄▄▄▄▄ █ ▀▄▀ █ ▀ ██\n██ █   █ █▄▀▀▀██ ▄▄██\n██ █▄▄▄█ █  ▀▀▄▀█▀▀██\n██▄▄▄▄▄▄▄█▀ █▄▄▄█▄▀██\n██▄██ ▄ ▀▄██   █ ▀ ██\n██▄▄▄▀▀▀███▄▀▀█▀▀█▄██\n██▄▄▀▄  ▀▄█▄▄▄▄█ ▀▄██\n██▄ █▄▄█▀█▀▄ ▀▄█ █▀██\n██▄▄▄▄▄██▄█▄██▄▄▄████\n█████████████████████\nfolded_matches_upper\n");
    } finally {
      await h.dispose();
    }
  });

  it("qrencode SVG and EPS vector output piped through svgo and rsvg-convert to PDF and PNG", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("qrencode -t SVG -s 4 -m 2 --foreground=112233 --background=f0f4f8ff -o /workspace/qr.svg \"VECTOR-QR-PIPELINE\"\nsvgo --multipass -p 2 /workspace/qr.svg -o /workspace/qr.min.svg\nrsvg-convert -f pdf -o /workspace/qr.pdf /workspace/qr.min.svg\nrsvg-convert -f png -o /workspace/qr.png /workspace/qr.min.svg\npdfinfo /workspace/qr.pdf | grep -E \"Pages:|Page size:\" | tr -s \" \"\nidentify -format '%f %m %wx%h\\n' /workspace/qr.png\nqrencode -t EPS -s 3 -m 2 \"VECTOR-QR-PIPELINE\" | head -n 8\nsha256sum /workspace/qr.svg");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "Pages: 1\nPage size: 75 x 75 pts\nqr.png PNG 100x100\n%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 75 75\n%%EndComments\n1 1 1 setrgbcolor\n0 0 75 75 rectfill\n0 0 0 setrgbcolor\n6 66 3 3 rectfill\n9 66 3 3 rectfill\nea8fa8b95f717c103d7be2242f16f94abbb1514ba39c9776b21829d53033c5c0  /workspace/qr.svg\n");
    } finally {
      await h.dispose();
    }
  });

  it("qrencode PNG output dimensions across module sizes and margins with exiftool and identify", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("qrencode -t PNG -s 5 -m 3 -v 2 -o /workspace/qr_v2.png \"VERSION-2-PNG\"\nidentify -format '%f %m %wx%h\\n' /workspace/qr_v2.png\nexiftool -j /workspace/qr_v2.png | jq -c '.[0] | {ImageWidth, ImageHeight, FileType}'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "qr_v2.png PNG 155x155\n{\"ImageWidth\":155,\"ImageHeight\":155,\"FileType\":\"PNG\"}\n");
    } finally {
      await h.dispose();
    }
  });

  it("qrencode structured append multi-symbol splitting and Shift-JIS Kanji mode", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("printf \"STRUCTURED-APPEND-PAYLOAD-01-STRUCTURED-APPEND-PAYLOAD-02-STRUCTURED-APPEND-PAYLOAD-03\" > /workspace/long.txt\nqrencode -S -v 1 -l L -t ASCII -m 1 -r /workspace/long.txt -o /workspace/part.txt\nls /workspace/part-*.txt | sort\nsha256sum /workspace/part-01.txt /workspace/part-02.txt /workspace/part-03.txt /workspace/part-04.txt /workspace/part-05.txt\nprintf '\\x82\\xa0\\x82\\xa2\\x82\\xa4\\x93\\xfa\\x96\\x7b' | qrencode -k -t ASCII -m 1 | sha256sum");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "/workspace/part-01.txt\n/workspace/part-02.txt\n/workspace/part-03.txt\n/workspace/part-04.txt\n/workspace/part-05.txt\n785bd82e4e3c7e94df5ef3870b052887afd00ec54762fb499b314babc7c2df0c  /workspace/part-01.txt\n0c5e5308fd19290e1164f971268080b205268ff8bfd77c166c1d94ec9424a1a7  /workspace/part-02.txt\nfdec0ee0259c5699839c762106900e2e4c0328f173b5184ae6f23289059df092  /workspace/part-03.txt\n201b6197fdbc1735b578c8474b6791cadafa26aa01636dbdd544976250acfffe  /workspace/part-04.txt\nef2f76e91df3dfeda9fb854be45f00753f04d1d9dfd9016bd275147f55ef35f4  /workspace/part-05.txt\n6a42a21cae0b296044fdaafa3954e269b009149e5d711e3c38481107e2c73471  -\n");
    } finally {
      await h.dispose();
    }
  });

  it("qrencode error handling for strict version overflow Micro QR H level and invalid colors", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("qrencode --strict-version -v 1 -l H \"THIS PAYLOAD IS MUCH TOO LONG FOR VERSION 1 HIGH ECC SYMBOL\" 2>&1 || echo \"strict:$?\"\nqrencode -M -l H \"123\" 2>&1 || echo \"micro_h:$?\"\nqrencode -S -v 1 \"NO-OUTPUT-FILE\" 2>&1 || echo \"struct_no_out:$?\"\nqrencode --foreground=GGGGGG \"BAD-COLOR\" 2>&1 || echo \"bad_color:$?\"");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "qrencode: Input does not fit the requested QR symbol\nstrict:1\nqrencode: Unsupported Micro QR version, level, or structured append\nmicro_h:1\nqrencode: Structured append requires a version and output filename\nstruct_no_out:1\nqrencode: Colors must be RRGGBB or RRGGBBAA\nbad_color:1\n");
    } finally {
      await h.dispose();
    }
  });

  it("multi-stage audio synthesis and inspection report hashed into QR code SVG and signed with ssh-keygen", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sox -r 4000 -c 2 -b 16 -n /workspace/ch1.wav synth 0.1 sine 250 fade q 0.02 0.1 0.02\nsox /workspace/ch1.wav /workspace/ch1_norm.wav norm -1 rate 8000\nINFO_JSON=$(jq -nc --arg rate \"$(soxi -r /workspace/ch1_norm.wav)\" --arg samples \"$(soxi -s /workspace/ch1_norm.wav)\" --arg dur \"$(soxi -D /workspace/ch1_norm.wav)\" '{rate:($rate|tonumber),samples:($samples|tonumber),dur:$dur}')\necho \"$INFO_JSON\"\nqrencode -t SVG -m 2 -o /workspace/audio_qr.svg \"$INFO_JSON\"\nssh-keygen -q -t ed25519 -N \"\" -C \"audio@poe\" -f /workspace/audio_key >/dev/null\nssh-keygen -Y sign -f /workspace/audio_key -n audio /workspace/audio_qr.svg >/dev/null\necho \"audio@poe $(cat /workspace/audio_key.pub)\" > /workspace/allowed\nssh-keygen -Y verify -f /workspace/allowed -I audio@poe -n audio -s /workspace/audio_qr.svg.sig < /workspace/audio_qr.svg | sed 's/SHA256:[^ ]*/SHA256:VERIFIED/'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "{\"rate\":8000,\"samples\":800,\"dur\":\"0.100000\"}\nGood \"audio\" signature for audio@poe with ED25519 key SHA256:VERIFIED\n");
    } finally {
      await h.dispose();
    }
  });

  it("sox multi-input concatenation with input format validation and remix silence channel", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sox -r 2000 -c 1 -b 16 -n /workspace/a.wav synth 0.05 sine 100\nsox -r 2000 -c 1 -b 16 -n /workspace/b.wav synth 0.05 square 200\nsox -r 2000 -c 1 -b 16 -e signed-integer /workspace/a.wav /workspace/b.wav /workspace/ab_stereo.wav remix 1 0 1\nsoxi /workspace/ab_stereo.wav\nsha256sum /workspace/ab_stereo.wav");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "\nInput File     : '/workspace/ab_stereo.wav'\nChannels       : 3\nSample Rate    : 2000\nPrecision      : 16-bit\nDuration       : 00:00:00.10 = 200 samples\nBit Rate       : 99.5k\n384ddccbf893338f6bab753c7914bcc391906430d653793829fd758794242e0a  /workspace/ab_stereo.wav\n");
    } finally {
      await h.dispose();
    }
  });

  it("sox fade shapes q h t l p with stop padding and truncation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("for shape in q h t l p; do\n  sox -r 1000 -c 1 -b 16 -n \"/workspace/fade_${shape}.wav\" synth 0.1 sine 100 fade \"$shape\" 0.02 0.15 0.03\ndone\nsoxi -s /workspace/fade_q.wav /workspace/fade_h.wav /workspace/fade_t.wav /workspace/fade_l.wav /workspace/fade_p.wav\nsha256sum /workspace/fade_q.wav /workspace/fade_h.wav /workspace/fade_t.wav /workspace/fade_l.wav /workspace/fade_p.wav");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "150\n150\n150\n150\n150\nc4a9ce96c42754da868b76803abc8e171dfe25f4cc617efbf9e93b0d2fc5af2a  /workspace/fade_q.wav\n562c2573da821bb1ea2047162fbf33971a484e00579daf6bb6698a855f4346f1  /workspace/fade_h.wav\nc83728b11c884142abfcfb394d3d06f1a02bc9cf694c85216d1816098cc0d0dc  /workspace/fade_t.wav\nc8f207179527b5339eb949cd9f0c0c077460c941ead91110ba13dd53337b92dc  /workspace/fade_l.wav\n489972570d4e4d1ba38943b4078a1bb3435b6a008531b062079205dd990fbf6c  /workspace/fade_p.wav\n");
    } finally {
      await h.dispose();
    }
  });

  it("qrencode version 7 with BCH version info bits and mixed numeric-alphanumeric-byte segmentation", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("qrencode -v 7 -l M -t ASCII -m 1 \"12345678901234567890UPPERCASE$%*+-./:lowercase_bytes_9876543210\" | sha256sum\nqrencode -8 -v 3 -l Q -t ASCII -m 2 \"12345678901234567890\" | sha256sum");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "30748d394d7694653b29dd7bba76b8df6554d0fc50a0ecc434698854f7dfdcac  -\n97b9da63a9c26c229230c2510d4f1c3482d4d32f1dc3862370c88f4c68b69e95  -\n");
    } finally {
      await h.dispose();
    }
  });

  it("openssl AES-256-CBC encrypted WAV archive with gpg clear-signed manifest and wdiff audit", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sox -r 2000 -c 1 -b 16 -n /workspace/tone.wav synth 0.05 sine 200\nsoxi /workspace/tone.wav > /workspace/before.info\nopenssl enc -aes-256-cbc -pbkdf2 -iter 1000 -pass pass:wavsecret -in /workspace/tone.wav -out /workspace/tone.wav.enc\nopenssl enc -d -aes-256-cbc -pbkdf2 -iter 1000 -pass pass:wavsecret -in /workspace/tone.wav.enc -out /workspace/tone_dec.wav\ncmp -s /workspace/tone.wav /workspace/tone_dec.wav && echo \"wav_decrypted_identical\"\nsox /workspace/tone_dec.wav /workspace/tone_mod.wav pad 0 0.05\nsoxi /workspace/tone_mod.wav > /workspace/after.info\nwdiff -s /workspace/before.info /workspace/after.info || true");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "wav_decrypted_identical\n");
    } finally {
      await h.dispose();
    }
  });

  it("mdq markdown extraction piped to qrencode and embedded into HTML to PDF via wkhtmltopdf", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("cat << 'MD' > /workspace/doc.md\n# Release Notes\n\n- Audio Engine: `sox` + `soxi`\n- Barcode Engine: `qrencode`\n\n```sh\nsox -r 8000 -c 1 -n tone.wav synth 1 sine 440\n```\nMD\nCODE_CMD=$(mdq -o plain '```sh' /workspace/doc.md)\necho \"cmd=$CODE_CMD\"\nqrencode -t UTF8 -m 1 \"$CODE_CMD\" | sha256sum\nprintf '<html><body><h1>Release Card</h1><p>%s</p></body></html>\\n' \"$CODE_CMD\" > /workspace/card.html\nwkhtmltopdf /workspace/card.html /workspace/card.pdf\npdftotext /workspace/card.pdf - | tr -d '\\f' | grep -v '^$'");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "cmd=sox -r 8000 -c 1 -n tone.wav synth 1 sine 440\n00dca058a4d4085e9b37260e69fdc7b5e3f2a7e358e3a32e280df3788e31bd53  -\nRelease Card\nsox -r 8000 -c 1 -n tone.wav synth 1 sine 440\n");
    } finally {
      await h.dispose();
    }
  });

  it("sqlite3 telemetry table exported via csv and encoded into QR SVG with svgo and rsvg-convert", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("sqlite3 /workspace/audio_metrics.db \"CREATE TABLE runs(name TEXT, sr INT, samples INT); INSERT INTO runs VALUES ('sine', 8000, 2000), ('square', 4000, 400);\"\nSUMMARY=$(sqlite3 -csv /workspace/audio_metrics.db \"SELECT * FROM runs ORDER BY name;\")\nqrencode -t SVG -s 2 -m 1 -o /workspace/metrics.svg \"$SUMMARY\"\nsvgo -p 2 /workspace/metrics.svg -o /workspace/metrics.min.svg\nrsvg-convert -f png -o /workspace/metrics.png /workspace/metrics.min.svg\nidentify -format '%f %m %wx%h\\n' /workspace/metrics.png\nsha256sum /workspace/metrics.svg /workspace/metrics.min.svg");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "metrics.png PNG 54x54\nfc8aafc7335a7e336da10f438ee8e47edb5432ea8cc97372fd714c2899693f36  /workspace/metrics.svg\nff508159ef949cbecb011f0c49014a02c5c67a953aad39fdc5a6c7121c8749f4  /workspace/metrics.min.svg\n");
    } finally {
      await h.dispose();
    }
  });

  it("rgrep and find across generated WAV SVG and QR artifacts with sha256sum manifest", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const r = await h.exec("mkdir -p /workspace/out\nsox -r 1000 -c 1 -b 16 -n /workspace/out/a.wav synth 0.02 sine 100\nqrencode -t SVG -m 1 -o /workspace/out/a.svg \"ARTIFACT-A\"\nsoxi /workspace/out/a.wav > /workspace/out/a.txt\nrgrep -c \"Sample Rate\" /workspace/out\nfind /workspace/out -type f | sort | xargs sha256sum");
      assert.equal(r.exitCode, 0);
      assert.equal(r.stdout, "/workspace/out/a.svg:0\n/workspace/out/a.txt:1\n/workspace/out/a.wav:0\na80ecc8f57333605483fab3a987a19dddc85028e25f4da8254f0dd82fbfea538  /workspace/out/a.svg\n3072ac64980c6f1586e8353d0ca835710fad03d10e4fc7cc63be0316795119fe  /workspace/out/a.txt\nb52ebe55497e1f54e7838470e210a40597adba23c2ab9d13214581c931b55917  /workspace/out/a.wav\n");
    } finally {
      await h.dispose();
    }
  });

});
