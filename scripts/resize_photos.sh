#!/usr/bin/env bash
# Ridimensiona le foto per il web (max 900px lato lungo, JPEG 82%)
# Eseguire dalla directory voting-site/:
#   bash scripts/resize_photos.sh

set -e

SRC="../Photos"
DST="photos"

mkdir -p "$DST"

echo "Ridimensionamento foto da $SRC → $DST"
count=0

for f in "$SRC"/*.jpg "$SRC"/*.JPG "$SRC"/*.jpeg; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  num="${base%%_*}"          # prefisso numerico (01, 02, …)
  out="$DST/${num}.jpg"
  convert "$f" \
    -resize 900x900\> \
    -quality 82 \
    -strip \
    "$out"
  size=$(du -k "$out" | cut -f1)
  echo "  $num.jpg  (${size} KB)"
  ((count++))
done

echo ""
echo "Processate $count foto in $DST/"
