# Owned media fixture

`preview.webm` is a 663-byte, half-second gray VP8 clip created locally for browser
playback checks. It contains no third-party footage, account data or audio.

Generation command (FFmpeg 8.0, already installed on the development machine):

```powershell
ffmpeg -f lavfi -i 'color=c=gray:s=160x90:r=10' -t 0.5 -c:v libvpx -an preview.webm
```

Tests read the committed fixture; running them does not require FFmpeg.
