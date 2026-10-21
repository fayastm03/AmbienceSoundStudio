#!/usr/bin/env bash
# Usage: ./prep.sh raw/rain public/sounds/rain
# Makes each clip loop-safe, loudness-matched, and 128 kbps MP3.
set -e
IN="$1"; OUT="$2"; FADE=2; MAXLEN=90
mkdir -p "$OUT"

for f in "$IN"/*.{mp3,wav,ogg,flac,m4a,aiff,aif}; do
  [ -e "$f" ] || continue
  name=$(basename "${f%.*}")
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  len=$(awk -v d="$dur" -v m="$MAXLEN" 'BEGIN{print (d>m)?m:d}')
  cut=$(awk -v l="$len" -v f="$FADE" 'BEGIN{print l-f}')

  ffmpeg -y -v error -t "$len" -i "$f" -filter_complex \
    "[0:a]atrim=start=$cut,asetpts=PTS-STARTPTS[t];\
     [0:a]atrim=end=$cut,asetpts=PTS-STARTPTS[b];\
     [t][b]acrossfade=d=$FADE:c1=qsin:c2=qsin,\
     loudnorm=I=-23:TP=-2:LRA=11[o]" \
    -map "[o]" -ar 44100 -c:a libmp3lame -b:a 128k "$OUT/$name.mp3"

  echo "Done: $OUT/$name.mp3"
done