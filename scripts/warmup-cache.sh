#!/usr/bin/env bash
# Warm up the S3-backed per-tile cache (Cache 1) for every tile_size/crop
# combo the cloud and Makefile flows are likely to request. Cache filenames
# are <md5>[_cropped].v2.<tile_size>.png — mode is not part of the key so
# we only need to vary tile_size and crop.

set -euo pipefail

# === edit these ===
SOURCE=mosaico/marco.jpeg              # any small image works
TILES=./tiles_dir                      # full library
BUCKET=emosaic-tiles-prod              # or emosaic-tiles-rc
# ==================

export AWS_REGION=eu-west-3
export EMOSAIC_S3_CACHE_BUCKET=$BUCKET
export EMOSAIC_S3_CACHE_PREFIX=cache/v2/

mkdir -p /tmp/warmup
TOTAL_START=$SECONDS

# (tile_size, crop_flag) pairs to populate.
# Skip 32/false — already done. Add 32/true (Makefile default).
configs=(
#  "16:"
  "16:--crop"
  "24:"
  "24:--crop"
  "32:--crop"
  "64:"
  "64:--crop"
  "128:"
  "128:--crop"
)

for cfg in "${configs[@]}"; do
  size=${cfg%%:*}
  crop_flag=${cfg#*:}
  label=${size}${crop_flag:+_cropped}
  echo
  echo "=== warmup: tile_size=$size ${crop_flag:-(no crop)} ==="
  start=$SECONDS
  # crop_flag is unquoted on purpose: empty → no argument, "--crop" → one
  # argument. Avoids the bash-3.2 "unbound variable" error you get with
  # "${arr[@]}" expansions of empty arrays under set -u.
  ./target/release/emosaic \
      "$SOURCE" \
      --tile-size "$size" \
      --output-path "/tmp/warmup/m_${label}.jpg" \
      $crop_flag \
      mosaic "$TILES" \
        --mode 1 \
        --downsample 16 \
        --extensions jpg --extensions jpeg --extensions JPG --extensions JPEG \
        --force
  echo "(took $((SECONDS - start))s)"
done

echo
echo "=== all done in $((SECONDS - TOTAL_START))s ==="
</content>
</invoke>
