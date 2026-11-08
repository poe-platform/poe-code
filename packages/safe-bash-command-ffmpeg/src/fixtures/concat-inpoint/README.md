Two 2-second H.264 clips at 5 fps, with keyframes at 0 and 1 second and no B-frames. Generated with native FFmpeg:

```sh
ffmpeg -v error -f lavfi -i testsrc2=size=64x48:rate=5:duration=2 -c:v libx264 -g 5 -keyint_min 5 -sc_threshold 0 -bf 0 a.mp4
ffmpeg -v error -f lavfi -i testsrc2=size=64x48:rate=5:duration=2 -vf negate -c:v libx264 -g 5 -keyint_min 5 -sc_threshold 0 -bf 0 b.mp4
```

With `file a.mp4`, `file b.mp4`, then `inpoint 1.4`, native FFmpeg stream-copies all ten A pictures and B pictures 5–9. B picture 7 is at 2 seconds and picture 9 at 2.4 seconds. The two preroll packets are repaired to successive ticks after A's final packet at 1.8 seconds. The exact tick size depends on the output track timescale.
