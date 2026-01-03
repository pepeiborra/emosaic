#!/bin/bash
# Entrypoint script for emosaic container
# Handles S3 download/upload and mosaic generation

set -e

# Function to write structured error and exit
write_error_and_exit() {
    local error_code="$1"
    local error_message="$2"

    echo "ERROR: $error_message"

    # Create error JSON
    ERROR_FILE="/app/output/error.json"
    mkdir -p /app/output
    cat > "$ERROR_FILE" <<EOF
{
  "error_code": "$error_code",
  "error_message": "$error_message"
}
EOF

    # Upload error.json to S3 if we have the necessary variables
    if [ -n "$S3_BUCKET" ] && [ -n "$OUTPUT_KEY" ]; then
        OUTPUT_PREFIX=$(dirname "$OUTPUT_KEY")
        echo "Uploading error information to S3..."
        aws s3 cp "$ERROR_FILE" "s3://$S3_BUCKET/$OUTPUT_PREFIX/error.json" \
            --content-type "application/json" || true
    fi

    exit 1
}

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
DOWNSAMPLE="${DOWNSAMPLE:-1}"
EXCLUDED_FOLDERS="${EXCLUDED_FOLDERS:-}"

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
echo "Downsample: $DOWNSAMPLE"
echo "Excluded Folders: $EXCLUDED_FOLDERS"

# Step 1: Download source image
echo ""
echo "=== Step 1: Downloading source image ==="
SOURCE_FILE="/app/tmp/source_image.jpg"
if ! aws s3 cp "s3://$S3_BUCKET/$SOURCE_IMAGE_KEY" "$SOURCE_FILE"; then
    write_error_and_exit "MISSING_SOURCE_IMAGE" "Failed to download source image from s3://$S3_BUCKET/$SOURCE_IMAGE_KEY"
fi
if [ ! -f "$SOURCE_FILE" ]; then
    write_error_and_exit "MISSING_SOURCE_IMAGE" "Source image file not found after download"
fi
echo "Downloaded: $(du -h $SOURCE_FILE | cut -f1)"

# Step 2: Download tiles
echo ""
echo "=== Step 2: Downloading tiles ==="
echo "Syncing from s3://$S3_BUCKET/$TILES_PREFIX to $TILES_DIR"

# Build exclude arguments for S3 sync
EXCLUDE_ARGS="--exclude .emosaic_* --exclude */.emosaic_*"
if [ -n "$EXCLUDED_FOLDERS" ]; then
    # Split comma-separated folders and add exclude patterns for each
    IFS=',' read -ra FOLDERS <<< "$EXCLUDED_FOLDERS"
    for folder in "${FOLDERS[@]}"; do
        # Trim whitespace
        folder=$(echo "$folder" | xargs)
        if [ -n "$folder" ]; then
            EXCLUDE_ARGS="$EXCLUDE_ARGS --exclude $folder/* --exclude $folder"
            echo "Excluding folder: $folder"
        fi
    done
fi

# Exclude cache files (.emosaic_*) as they contain absolute paths from local builds
if ! eval "aws s3 sync \"s3://$S3_BUCKET/$TILES_PREFIX\" \"$TILES_DIR\" --quiet $EXCLUDE_ARGS"; then
    write_error_and_exit "MISSING_TILES" "Failed to sync tiles from s3://$S3_BUCKET/$TILES_PREFIX"
fi
TILE_COUNT=$(find "$TILES_DIR" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" \) | wc -l)
echo "Downloaded $TILE_COUNT tiles"

if [ "$TILE_COUNT" -eq 0 ]; then
    write_error_and_exit "MISSING_TILES" "No tile images found in s3://$S3_BUCKET/$TILES_PREFIX"
fi

# Step 3: Run mosaic generation
echo ""
echo "=== Step 3: Generating mosaic ==="
OUTPUT_DIR="/app/output"
OUTPUT_IMAGE="$OUTPUT_DIR/mosaic.png"

# Build command arguments
# Global options (before subcommand): --tile-size, --crop, -o
# Subcommand options (after 'mosaic'): --mode, --tint-opacity, --web, --no-repeat, --randomize
CMD_ARGS=(
    "--tile-size" "$TILE_SIZE"
    "-o" "$OUTPUT_IMAGE"
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
    "--extensions" "jpg"
    "--extensions" "jpeg"
    "--extensions" "png"
)

# Add subcommand optional flags
if [ "$NO_REPEAT" = "true" ]; then
    CMD_ARGS+=("--no-repeat")
fi

if [ "$RANDOMIZE" != "0" ]; then
    CMD_ARGS+=("--randomize" "$RANDOMIZE")
fi

if [ "$DOWNSAMPLE" != "1" ]; then
    CMD_ARGS+=("--downsample" "$DOWNSAMPLE")
fi

# Run emosaic
echo "Command: /app/emosaic ${CMD_ARGS[*]}"
if ! /app/emosaic "${CMD_ARGS[@]}" 2>&1 | tee /app/output/generation.log; then
    # Check the log for specific error patterns
    if grep -q "Need.*tiles but only.*available" /app/output/generation.log 2>/dev/null; then
        # Extract the error message from the log
        TILE_ERROR=$(grep "Need.*tiles but only.*available" /app/output/generation.log | head -1)
        write_error_and_exit "INSUFFICIENT_TILES" "$TILE_ERROR"
    else
        write_error_and_exit "GENERATION_FAILED" "Mosaic generation command failed. See CloudWatch logs for details."
    fi
fi

if [ ! -f "$OUTPUT_IMAGE" ]; then
    write_error_and_exit "GENERATION_FAILED" "Mosaic generation completed but output image was not created"
fi

OUTPUT_SIZE=$(du -h "$OUTPUT_IMAGE" | cut -f1)
echo "Mosaic image generated successfully: $OUTPUT_SIZE"

# List all generated files
echo "Generated files:"
ls -la "$OUTPUT_DIR"

# Step 4: Upload outputs to S3
echo ""
echo "=== Step 4: Uploading outputs ==="

# Derive the output prefix from OUTPUT_KEY (remove filename, keep directory)
OUTPUT_PREFIX=$(dirname "$OUTPUT_KEY")

# Upload the main mosaic image (PNG)
echo "Uploading mosaic image..."
if ! aws s3 cp "$OUTPUT_IMAGE" "s3://$S3_BUCKET/$OUTPUT_PREFIX/mosaic.png" \
    --content-type "image/png" \
    --metadata "mosaic-id=${MOSAIC_ID:-unknown},job-id=${JOB_ID:-unknown}"; then
    write_error_and_exit "UPLOAD_FAILED" "Failed to upload mosaic.png to s3://$S3_BUCKET/$OUTPUT_PREFIX/"
fi

# Upload HTML file if it exists
HTML_FILE="$OUTPUT_DIR/mosaic.html"
if [ -f "$HTML_FILE" ]; then
    echo "Uploading HTML file..."
    aws s3 cp "$HTML_FILE" "s3://$S3_BUCKET/$OUTPUT_PREFIX/mosaic.html" \
        --content-type "text/html"
fi

# Upload widget HTML if it exists
WIDGET_FILE="$OUTPUT_DIR/mosaic_widget.html"
if [ -f "$WIDGET_FILE" ]; then
    echo "Uploading widget HTML..."
    aws s3 cp "$WIDGET_FILE" "s3://$S3_BUCKET/$OUTPUT_PREFIX/mosaic_widget.html" \
        --content-type "text/html"
fi

# Upload CSS if it exists
CSS_FILE="$OUTPUT_DIR/mosaic-widget.css"
if [ -f "$CSS_FILE" ]; then
    echo "Uploading CSS..."
    aws s3 cp "$CSS_FILE" "s3://$S3_BUCKET/$OUTPUT_PREFIX/mosaic-widget.css" \
        --content-type "text/css"
fi

# Upload JavaScript if it exists
JS_FILE="$OUTPUT_DIR/mosaic-widget.js"
if [ -f "$JS_FILE" ]; then
    echo "Uploading JavaScript..."
    aws s3 cp "$JS_FILE" "s3://$S3_BUCKET/$OUTPUT_PREFIX/mosaic-widget.js" \
        --content-type "application/javascript"
fi

# Upload stats image if it exists
STATS_FILE="$OUTPUT_DIR/mosaic.stats.png"
if [ -f "$STATS_FILE" ]; then
    echo "Uploading stats image..."
    aws s3 cp "$STATS_FILE" "s3://$S3_BUCKET/$OUTPUT_PREFIX/mosaic.stats.png" \
        --content-type "image/png"
fi

# Upload stats JSON if it exists
STATS_JSON_FILE="$OUTPUT_DIR/mosaic.stats.json"
if [ -f "$STATS_JSON_FILE" ]; then
    echo "Uploading stats JSON..."
    aws s3 cp "$STATS_JSON_FILE" "s3://$S3_BUCKET/$OUTPUT_PREFIX/mosaic.stats.json" \
        --content-type "application/json"
fi

echo "All files uploaded to s3://$S3_BUCKET/$OUTPUT_PREFIX/"

# Step 5: Generate and upload thumbnail
echo ""
echo "=== Step 5: Generating thumbnail ==="
THUMBNAIL_FILE="$OUTPUT_DIR/mosaic.thumb.png"
THUMBNAIL_SIZE="300x300"

if command -v convert &> /dev/null; then
    echo "Generating ${THUMBNAIL_SIZE} thumbnail..."
    if convert "$OUTPUT_IMAGE" -resize "$THUMBNAIL_SIZE" -quality 85 "$THUMBNAIL_FILE"; then
        THUMB_SIZE=$(du -h "$THUMBNAIL_FILE" | cut -f1)
        echo "Thumbnail generated: $THUMB_SIZE"

        echo "Uploading thumbnail..."
        if aws s3 cp "$THUMBNAIL_FILE" "s3://$S3_BUCKET/$OUTPUT_PREFIX/mosaic.thumb.png" \
            --content-type "image/png"; then
            echo "Thumbnail uploaded successfully"
        else
            echo "Warning: Failed to upload thumbnail (non-fatal)"
        fi
    else
        echo "Warning: Failed to generate thumbnail (non-fatal)"
    fi
else
    echo "Warning: ImageMagick not available, skipping thumbnail generation"
fi

# Cleanup
echo ""
echo "=== Cleanup ==="
rm -rf /app/tmp/*
echo "Temporary files cleaned"

echo ""
echo "=== Job Complete ==="
date
exit 0
