#!/bin/bash
# Entrypoint script for emosaic container
# Handles S3 download/upload and mosaic generation

set -e

echo "=== Emosaic Container Starting ==="
echo "Job ID: ${JOB_ID:-unknown}"
echo "Mosaic ID: ${MOSAIC_ID:-unknown}"
date

# Required environment variables
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${SOURCE_IMAGE_KEY:?SOURCE_IMAGE_KEY is required}"
: "${OUTPUT_KEY:?OUTPUT_KEY is required}"
: "${TILES_PREFIX:?TILES_PREFIX is required}"

# Directories
TILES_DIR="/app/tiles"

# Optional parameters with defaults
TILE_SIZE="${TILE_SIZE:-32}"
MODE="${MODE:-16}"
TINT_OPACITY="${TINT_OPACITY:-0.5}"
NO_REPEAT="${NO_REPEAT:-false}"
CROP="${CROP:-false}"
RANDOMIZE="${RANDOMIZE:-0}"

echo ""
echo "=== Configuration ==="
echo "S3 Bucket: $S3_BUCKET"
echo "Source Image: s3://$S3_BUCKET/$SOURCE_IMAGE_KEY"
echo "Output: s3://$S3_BUCKET/$OUTPUT_KEY"
echo "Tiles Prefix: s3://$S3_BUCKET/$TILES_PREFIX"
echo "Tile Size: $TILE_SIZE"
echo "Mode: $MODE"
echo "Tint Opacity: $TINT_OPACITY"
echo "No Repeat: $NO_REPEAT"
echo "Crop: $CROP"
echo "Randomize: $RANDOMIZE"

# Step 1: Download source image
echo ""
echo "=== Step 1: Downloading source image ==="
SOURCE_FILE="/app/tmp/source_image.jpg"
aws s3 cp "s3://$S3_BUCKET/$SOURCE_IMAGE_KEY" "$SOURCE_FILE"
if [ ! -f "$SOURCE_FILE" ]; then
    echo "ERROR: Failed to download source image"
    exit 1
fi
echo "Downloaded: $(du -h $SOURCE_FILE | cut -f1)"

# Step 2: Download tiles
echo ""
echo "=== Step 2: Downloading tiles ==="
echo "Syncing from s3://$S3_BUCKET/$TILES_PREFIX to $TILES_DIR"
aws s3 sync "s3://$S3_BUCKET/$TILES_PREFIX" "$TILES_DIR" --quiet
TILE_COUNT=$(find "$TILES_DIR" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" \) | wc -l)
echo "Downloaded $TILE_COUNT tiles"

if [ "$TILE_COUNT" -eq 0 ]; then
    echo "ERROR: No tiles found in $TILES_DIR"
    exit 1
fi

# Step 3: Run mosaic generation
echo ""
echo "=== Step 3: Generating mosaic ==="
OUTPUT_FILE="/app/output/mosaic.html"

# Build command arguments
# Global options (before subcommand): --tile-size, --crop, -o
# Subcommand options (after 'mosaic'): --mode, --tint-opacity, --web, --no-repeat, --randomize
CMD_ARGS=(
    "--tile-size" "$TILE_SIZE"
    "-o" "$OUTPUT_FILE"
)

# Add --crop before subcommand if enabled
if [ "$CROP" = "true" ]; then
    CMD_ARGS+=("--crop")
fi

# Add source image and subcommand
CMD_ARGS+=(
    "$SOURCE_FILE"
    "mosaic"
    "$TILES_DIR"
    "--mode" "$MODE"
    "--tint-opacity" "$TINT_OPACITY"
    "--web"
)

# Add subcommand optional flags
if [ "$NO_REPEAT" = "true" ]; then
    CMD_ARGS+=("--no-repeat")
fi

if [ "$RANDOMIZE" != "0" ]; then
    CMD_ARGS+=("--randomize" "$RANDOMIZE")
fi

# Run emosaic
echo "Command: /app/emosaic ${CMD_ARGS[*]}"
/app/emosaic "${CMD_ARGS[@]}"

if [ ! -f "$OUTPUT_FILE" ]; then
    echo "ERROR: Mosaic generation failed - output file not created"
    exit 1
fi

OUTPUT_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
echo "Mosaic generated successfully: $OUTPUT_SIZE"

# Step 4: Upload output to S3
echo ""
echo "=== Step 4: Uploading output ==="
aws s3 cp "$OUTPUT_FILE" "s3://$S3_BUCKET/$OUTPUT_KEY" \
    --content-type "text/html" \
    --metadata "mosaic-id=${MOSAIC_ID:-unknown},job-id=${JOB_ID:-unknown}"

echo "Uploaded to s3://$S3_BUCKET/$OUTPUT_KEY"

# Optional: Generate and upload thumbnail (extract from HTML or generate separately)
# This would be a future enhancement

# Cleanup
echo ""
echo "=== Cleanup ==="
rm -rf /app/tmp/*
echo "Temporary files cleaned"

echo ""
echo "=== Job Complete ==="
date
exit 0
