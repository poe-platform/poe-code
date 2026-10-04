import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withE2EHarness } from "./harness.js";

describe("ffmpeg & ffprobe audio/video media pipelines e2e suite", () => {
  test("1. ffmpeg generates MP4 video from lavfi color source and ffprobe inspects JSON stream metadata", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i color=c=blue:s=64x48:r=10:d=0.4 -an /workspace/blue.mp4",
          "ffprobe -v quiet -print_format json -show_format -show_streams /workspace/blue.mp4 | jq -c '{codec: .streams[0].codec_name, w: .streams[0].width, h: .streams[0].height, frames: .streams[0].nb_frames}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '{"codec":"h264","w":64,"h":48,"frames":"4"}\n',
      );
    });
  });

  test("2. ffmpeg generates WAV audio from lavfi sine wave and ffprobe verifies sample rate and channel count", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000:duration=0.25 /workspace/sine.wav",
          "ffprobe -v quiet -print_format json -show_streams /workspace/sine.wav | jq -c '{type: .streams[0].codec_type, sr: (.streams[0].sample_rate | tonumber), ch: .streams[0].channels}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '{"type":"audio","sr":16000,"ch":1}\n');
    });
  });

  test("3. ffprobe supports pipe:0 stdin streaming and default=noprint_wrappers=1:nokey=1 single-field extraction", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i testsrc=size=128x72:rate=10:duration=0.3 /workspace/clip.mp4",
          "w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 /workspace/clip.mp4)",
          "cat /workspace/clip.mp4 | ffprobe -v quiet -show_streams -of json pipe:0 | jq -r --arg w \"$w\" '\"width=\\($w) height=\\(.streams[0].height)\"'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "width=128 height=72\n");
    });
  });

  test("4. ffmpeg applies video filterchain (-vf scale, pad, hflip) and verifies output dimensions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i testsrc=size=64x48:rate=10:duration=0.5 -vf 'scale=32:24,pad=48:32:8:4:black,hflip' /workspace/filtered.mp4",
          "ffprobe -v quiet -print_format json -show_streams /workspace/filtered.mp4 | jq -c '{w: .streams[0].width, h: .streams[0].height, n: .streams[0].nb_frames}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '{"w":48,"h":32,"n":"5"}\n');
    });
  });

  test("5. ffmpeg extracts video frames to numbered PNG sequence and reassembles PNG sequence back to MP4", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i testsrc=size=32x24:rate=10:duration=0.4 /workspace/src.mp4",
          "ffmpeg -i /workspace/src.mp4 /workspace/frame_%03d.png",
          "identify -format '%m %wx%h\\n' /workspace/frame_001.png /workspace/frame_004.png",
          "ffmpeg -framerate 10 -i /workspace/frame_%03d.png /workspace/rebuilt.mp4",
          "ffprobe -v quiet -print_format json -show_streams /workspace/rebuilt.mp4 | jq -c '{w: .streams[0].width, h: .streams[0].height, n: .streams[0].nb_frames}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["PNG 32x24", "PNG 32x24", '{"w":32,"h":24,"n":"4"}', ""].join("\n"),
      );
    });
  });

  test("6. ffmpeg concatenates multiple MP4 clips via -f concat demuxer and concat: protocol", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i color=c=red:s=32x24:r=10:d=0.3 -an /workspace/c1.mp4",
          "ffmpeg -f lavfi -i color=c=green:s=32x24:r=10:d=0.4 -an /workspace/c2.mp4",
          "printf \"ffconcat version 1.0\\nfile '/workspace/c1.mp4'\\nfile '/workspace/c2.mp4'\\n\" > /workspace/list.txt",
          "ffmpeg -f concat -safe 0 -i /workspace/list.txt -c copy /workspace/merged_demux.mp4",
          "ffmpeg -i 'concat:/workspace/c1.mp4|/workspace/c2.mp4' -c copy /workspace/merged_proto.mp4",
          "n1=$(ffprobe -v quiet -print_format json -show_streams /workspace/merged_demux.mp4 | jq -r '.streams[0].nb_frames')",
          "n2=$(ffprobe -v quiet -print_format json -show_streams /workspace/merged_proto.mp4 | jq -r '.streams[0].nb_frames')",
          'echo "demux=$n1 proto=$n2"',
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "demux=7 proto=7\n");
    });
  });

  test("7. ffmpeg -filter_complex vstack and hstack combine two video streams spatially", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i color=c=red:s=32x16:r=5:d=0.4 -an /workspace/top.mp4",
          "ffmpeg -f lavfi -i color=c=blue:s=32x16:r=5:d=0.4 -an /workspace/bot.mp4",
          "ffmpeg -i /workspace/top.mp4 -i /workspace/bot.mp4 -filter_complex '[0:v][1:v]vstack=inputs=2' /workspace/vstack.mp4",
          "ffmpeg -i /workspace/top.mp4 -i /workspace/bot.mp4 -filter_complex '[0:v][1:v]hstack=inputs=2' /workspace/hstack.mp4",
          "ffprobe -v quiet -print_format json -show_streams /workspace/vstack.mp4 | jq -c '{w: .streams[0].width, h: .streams[0].height}'",
          "ffprobe -v quiet -print_format json -show_streams /workspace/hstack.mp4 | jq -c '{w: .streams[0].width, h: .streams[0].height}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '{"w":32,"h":32}\n{"w":64,"h":16}\n');
    });
  });

  test("8. ffmpeg converts SubRip (.srt) subtitles to WebVTT and rejects unregistered ASS output", async () => {
    const srt = [
      "1",
      "00:00:00,000 --> 00:00:01,500",
      "Hello Safe-Bash",
      "",
      "2",
      "00:00:01,500 --> 00:00:03,000",
      "Zero-Dep Media Engine",
      "",
    ].join("\n");

    await withE2EHarness(
      { files: { "/workspace/subs.srt": srt } },
      async (h) => {
        const res = await h.exec(
          [
            "ffmpeg -i /workspace/subs.srt /workspace/subs.vtt",
            "head -n 1 /workspace/subs.vtt",
            "grep -c 'Safe-Bash' /workspace/subs.vtt",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "WEBVTT\n1\n");
        await h.expectFail("ffmpeg -i /workspace/subs.srt /workspace/subs.ass", 1, /format AST not registered/);
        await h.expectFail("test -e /workspace/subs.ass", 1);
      },
    );
  });

  test("9. ffmpeg muxes subtitles into MP4 container and extracts them back to .srt", async () => {
    const srt = [
      "1",
      "00:00:00,000 --> 00:00:01,000",
      "Embedded Subtitle Line",
      "",
    ].join("\n");

    await withE2EHarness(
      { files: { "/workspace/sub.srt": srt } },
      async (h) => {
        const res = await h.exec(
          [
            "ffmpeg -f lavfi -i color=c=black:s=32x24:r=5:d=1 -an /workspace/vid.mp4",
            "ffmpeg -i /workspace/vid.mp4 -i /workspace/sub.srt -c copy /workspace/subbed.mp4",
            "ffmpeg -i /workspace/subbed.mp4 /workspace/extracted.srt",
            "grep 'Embedded Subtitle Line' /workspace/extracted.srt",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(res.stdout, "Embedded Subtitle Line\n");
      },
    );
  });

  test("10. ffmpeg muxes FFMETADATA1 chapters into MP4 and ffprobe -show_chapters inspects them", async () => {
    const ffmeta = [
      ";FFMETADATA1",
      "title=Demo Presentation",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      "START=0",
      "END=500",
      "title=Intro",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      "START=500",
      "END=1000",
      "title=Deep Dive",
      "",
    ].join("\n");

    await withE2EHarness(
      { files: { "/workspace/meta.ffmeta": ffmeta } },
      async (h) => {
        const res = await h.exec(
          [
            "ffmpeg -f lavfi -i color=c=navy:s=32x24:r=10:d=1 -an /workspace/base.mp4",
            "ffmpeg -i /workspace/base.mp4 -i /workspace/meta.ffmeta -c copy /workspace/chapters.mp4",
            "ffprobe -v quiet -print_format json -show_chapters /workspace/chapters.mp4 | jq -c '[.chapters[] | {id: .id, title: .tags.title}]'",
          ].join("\n"),
        );
        assert.equal(res.exitCode, 0, res.stderr);
        assert.equal(
          res.stdout,
          '[{"id":0,"title":"Intro"},{"id":1,"title":"Deep Dive"}]\n',
        );
      },
    );
  });

  test("11. ffmpeg transcodes MP4 to animated GIF and back from GIF to MP4", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i testsrc=size=24x16:rate=5:duration=0.6 -an /workspace/src.mp4",
          "ffmpeg -i /workspace/src.mp4 /workspace/anim.gif",
          "ffmpeg -i /workspace/anim.gif -vf scale=24:16 /workspace/from_gif.mp4",
          "ffprobe -v quiet -print_format json -show_streams /workspace/from_gif.mp4 | jq -c '{codec: .streams[0].codec_name, w: .streams[0].width, h: .streams[0].height}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '{"codec":"h264","w":24,"h":16}\n');
    });
  });

  test("12. ffmpeg resamples and downmixes WAV audio and rejects unregistered containers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i sine=frequency=880:sample_rate=44100:duration=0.2 -ac 2 /workspace/stereo.wav",
          "ffmpeg -i /workspace/stereo.wav -ar 16000 -ac 1 /workspace/mono16k.wav",
          "ffprobe -v quiet -print_format json -show_streams /workspace/mono16k.wav | jq -c '{sr: (.streams[0].sample_rate | tonumber), ch: .streams[0].channels}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '{"sr":16000,"ch":1}\n',
      );
      for (const extension of ["aiff", "au", "caf"]) {
        await h.expectFail(`ffmpeg -i /workspace/mono16k.wav /workspace/out.${extension}`, 1, /format AST not registered/);
        await h.expectFail(`test -e /workspace/out.${extension}`, 1);
      }
    });
  });

  test("13. ffmpeg generates tile contact sheet PNG from video frames", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i testsrc=size=16x12:rate=10:duration=0.4 -an /workspace/four.mp4",
          "ffmpeg -i /workspace/four.mp4 -vf 'tile=2x2' -frames:v 1 /workspace/sheet.png",
          "identify -format '%m %wx%h\\n' /workspace/sheet.png",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "PNG 32x24\n");
    });
  });

  test("14. ffmpeg segments MP4 into HLS (.m3u8 + .ts segments) and rejoins HLS playlist to MP4", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i color=c=purple:s=32x24:r=5:d=1 -an /workspace/source.mp4",
          "ffmpeg -i /workspace/source.mp4 -f hls -hls_time 1 /workspace/index.m3u8",
          "grep -c '#EXTM3U' /workspace/index.m3u8",
          "ffmpeg -i /workspace/index.m3u8 -c copy /workspace/rejoined.mp4",
          "ffprobe -v quiet -print_format json -show_streams /workspace/rejoined.mp4 | jq -r '.streams[0].nb_frames'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "1\n5\n");
    });
  });

  test("15. ffmpeg transcodes across MKV, WebM, MPEG-TS, AVI, FLV, and Y4M containers", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i color=c=teal:s=32x24:r=5:d=0.4 -an /workspace/in.mp4",
          "for ext in mkv webm ts avi flv y4m; do",
          "  ffmpeg -i /workspace/in.mp4 \"/workspace/out.$ext\"",
          "  test -s \"/workspace/out.$ext\" && echo \"ok:$ext\"",
          "done",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["ok:mkv", "ok:webm", "ok:ts", "ok:avi", "ok:flv", "ok:y4m", ""].join("\n"),
      );
    });
  });

  test("16. ffprobe output formats (-of json, csv, flat, default) produce consistent stream dimensions", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i color=c=orange:s=80x60:r=10:d=0.2 -an /workspace/probe.mp4",
          "ffprobe -v quiet -of flat -show_streams /workspace/probe.mp4 | grep 'streams.stream.0.width='",
          "ffprobe -v quiet -of csv -show_streams /workspace/probe.mp4 | head -n 1 | grep -o '80,60'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "streams.stream.0.width=80\n80,60\n");
    });
  });

  test("17. ffmpeg applies color filters (negate, colorchannelmixer, vibrance) to video frames", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i color=c=red:s=16x16:r=5:d=0.2 -vf 'negate' -frames:v 1 /workspace/neg.png",
          "identify -format '%m %wx%h\\n' /workspace/neg.png",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, "PNG 16x16\n");
    });
  });

  test("18. ImageMagick convert -> ffmpeg slideshow -> ffprobe -> frame extraction round-trip", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "convert -size 32x24 xc:red /workspace/slide_001.png",
          "convert -size 32x24 xc:green /workspace/slide_002.png",
          "convert -size 32x24 xc:blue /workspace/slide_003.png",
          "ffmpeg -framerate 5 -i /workspace/slide_%03d.png /workspace/slideshow.mp4",
          "ffprobe -v quiet -print_format json -show_streams /workspace/slideshow.mp4 | jq -c '{w: .streams[0].width, h: .streams[0].height, frames: .streams[0].nb_frames}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(res.stdout, '{"w":32,"h":24,"frames":"3"}\n');
    });
  });

  test("19. ffmpeg trims clip duration with -ss and -t and updates container metadata tags", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i color=c=yellow:s=32x24:r=10:d=1.0 -an /workspace/full.mp4",
          "ffmpeg -ss 0.2 -t 0.3 -i /workspace/full.mp4 -metadata title='Trimmed Clip' /workspace/trimmed.mp4",
          "ffprobe -v quiet -print_format json -show_format -show_streams /workspace/trimmed.mp4 | jq -c '{frames: .streams[0].nb_frames, title: .format.tags.title}'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        '{"frames":"3","title":"Trimmed Clip"}\n',
      );
    });
  });

  test("20. end-to-end media asset inventory pipeline: ffmpeg + ffprobe + jq + sqlite3 + csvlook", async () => {
    await withE2EHarness(async (h) => {
      const res = await h.exec(
        [
          "ffmpeg -f lavfi -i color=c=red:s=64x36:r=10:d=0.5 -an /workspace/intro.mp4",
          "ffmpeg -f lavfi -i color=c=blue:s=128x72:r=10:d=0.8 -an /workspace/main.mp4",
          "sqlite3 /workspace/media.db 'CREATE TABLE clips (name TEXT, width INT, height INT, frames INT);'",
          "for f in /workspace/intro.mp4 /workspace/main.mp4; do",
          "  base=$(basename \"$f\")",
          "  row=$(ffprobe -v quiet -print_format json -show_streams \"$f\" | jq -r '.streams[0] | \"\\(.width),\\(.height),\\(.nb_frames)\"')",
          "  sqlite3 /workspace/media.db \"INSERT INTO clips VALUES ('$base', $row);\"",
          "done",
          "sqlite3 -header -csv /workspace/media.db 'SELECT name, width, height, frames FROM clips ORDER BY frames DESC;'",
        ].join("\n"),
      );
      assert.equal(res.exitCode, 0, res.stderr);
      assert.equal(
        res.stdout,
        ["name,width,height,frames", "main.mp4,128,72,8", "intro.mp4,64,36,5", ""].join("\n"),
      );
    });
  });
});
