Native FFmpeg 9.0.1 fixtures (16×16 H.264, 16 kHz AAC, one second):

```sh
ffmpeg -v error -f lavfi -i testsrc2=size=16x16:rate=5:duration=1 -f lavfi -i sine=frequency=440:sample_rate=16000:duration=1 -map 0:v -map 1:a -c:v libx264 -g 1 -c:a aac base.mp4
ffmpeg -v error -i base.mp4 -map 0:v -map 0:a -c copy -output_ts_offset 2 shifted.mp4
ffmpeg -v error -i base.mp4 -itsoffset 0.5 -i base.mp4 -map 0:v -map 1:a -c copy delayed.mp4
```

Copying `base.mp4` retains first packet PTS 0/-0.064 seconds (video/audio).
Copying `shifted.mp4` rebases them to approximately 0.064/0; mapping base video
and shifted audio produces 0/0. Copying `delayed.mp4` preserves 0/0.436.
Each output retains five video and seventeen audio packets.
