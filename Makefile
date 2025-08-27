# Mosaic Generation and Upload Makefile
#
# Usage:
#   make upload                    # Uses default settings (marco2)
#   make upload FILE=photo1        # Custom file
#   make upload TILE_SIZE=16       # Custom tile size
#   make upload FILE=test CROP=0   # Multiple overrides

# Default configuration
FILE ?= marco2.jpeg
TILE_SIZE ?= 32
MODE ?= 32
OPACITY ?= 0
MORE ?= no-repeat
CROP ?= 1
FORCE ?= 0
TILES_DIR ?= /Users/pepe/Library/Mobile Documents/com~apple~CloudDocs/Fotos campo
S3_BUCKET ?= casadelmanco.com
DISTRIBUTION_ID ?= E2KW8FQIKWXD1D
TITLE ?= Casa del Manco
TIMESTAMP := $(shell date +%Y%m%d%H%M%S)
DOWNSAMPLE=1

# Helper to replace spaces in MORE variable
space := $(empty) $(empty)

# Derived variables
MORE_WORDS := $(MORE)
MORE_ARGS := $(addprefix --,$(MORE_WORDS))
OUTPUT_SUFFIX := $(if $(MORE),_$(subst $(space),_,$(MORE)))
CROP_FLAG := $(if $(filter 1,$(CROP)),--crop)
FORCE_FLAG := $(if $(filter 1,$(FORCE)),--force)
OUTPUT_SUFFIX := $(OUTPUT_SUFFIX)$(if $(filter 1,$(CROP)),_cropped)

# Output filenames
OUTPUT_NAME := $(FILE)_$(TILE_SIZE)_$(MODE)_$(OPACITY)_$(DOWNSAMPLE)$(OUTPUT_SUFFIX)
OUTPUT_FOLDER := /tmp/$(TIMESTAMP)
OUTPUT_JPG := $(OUTPUT_FOLDER)/$(OUTPUT_NAME).jpg
OUTPUT_HTML := $(OUTPUT_FOLDER)/$(OUTPUT_NAME).html
INPUT_JPG := mosaico/$(FILE)

.PHONY: generate upload clean help check-deps check-input

# Main target
upload: generate check-deps check-input upload-files

deploy : upload
	@echo "Updating index.html"
	aws s3 cp s3://$(S3_BUCKET)/$(OUTPUT_NAME)_widget.html s3://$(S3_BUCKET)/index.html
	@echo "Invalidating CloudFront cache..."
	aws cloudfront create-invalidation \
  --distribution-id $(DISTRIBUTION_ID) \
  --paths "/*" \
  --output table \
	--no-cli-pager
	@echo "✅ Successfully generated and uploaded mosaic!"
	@echo "🌐 Available at: https://$(S3_BUCKET)/"


# Generate the mosaic
generate: $(INPUT_JPG)
	@echo "🎯 Starting mosaic generation..."
	@echo "📁 Input: $(INPUT_JPG)"
	@echo "📁 Output JPG: $(OUTPUT_JPG)"
	@echo
	@mkdir -p $(OUTPUT_FOLDER)
	@echo "🧩 Generating mosaic..."
	cargo run --release -- \
		"$(INPUT_JPG)" \
		--tile-size $(TILE_SIZE) \
		$(CROP_FLAG) \
		--output-path "$(OUTPUT_JPG)" \
		mosaic "$(TILES_DIR)" \
		--mode $(MODE) \
		--tint-opacity $(OPACITY) \
		--downsample $(DOWNSAMPLE) \
		$(MORE_ARGS) \
		--extensions jpg \
		--extensions jpeg \
		--extensions JPG \
		--extensions JPEG \
		--title "$(TITLE)" \
		$(FORCE_FLAG) \
		--web

# Upload files to S3
upload-files:
	@echo "📤 Uploading files to S3..."
	@aws s3 sync "$(OUTPUT_FOLDER)" "s3://$(S3_BUCKET)"

# Check dependencies
check-deps:
	@command -v cargo >/dev/null || (echo "❌ cargo not found. Install Rust." && exit 1)
	@command -v aws >/dev/null || (echo "❌ aws CLI not found. Install AWS CLI." && exit 1)
	@aws sts get-caller-identity >/dev/null || (echo "❌ AWS not configured. Run 'aws configure'." && exit 1)

# Check input file exists
check-input:
	@test -f "$(INPUT_JPG)" || (echo "❌ Input file not found: $(INPUT_JPG)" && exit 1)

# Show help
help:
	@echo "Mosaic Generation and Upload Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  upload     Generate mosaic and upload to S3 (default)"
	@echo "  generate   Generate mosaic files only (no upload)"
	@echo "  help       Show this help"
	@echo ""
	@echo "Configuration Variables:"
	@echo "  FILE       Input filename (default: marco2)"
	@echo "  OUTPUT_FOLDER  Output folder (default: /tmp/$(date))"
	@echo "  TILE_SIZE  Tile size (default: 32)"
	@echo "  MODE       Mosaic mode (default: 32)"
	@echo "  DOWNSAMPLE downsample original image (default:1)"
	@echo "  OPACITY    Tint opacity (default: 0)"
	@echo "  MORE       Additional flags (default: no-repeat downsample=4)"
	@echo "  CROP       Enable cropping 1/0 (default: 1)"
	@echo "  TILES_DIR  Tile images directory"
	@echo "  S3_BUCKET  S3 bucket name (default: casadelmanco.com)"
	@echo "  TITLE      HTML page title (default: Casa del Manco)"
	@echo ""
	@echo "Examples:"
	@echo "  make upload                    # Use defaults (marco2)"
	@echo "  make upload FILE=photo1        # Custom file"
	@echo "  make upload TILE_SIZE=16       # Custom tile size"
	@echo "  make upload FILE=test CROP=0   # Multiple overrides"
	@echo "  make upload TITLE='My Mosaic'  # Custom title"
	@echo "  make generate FILE=test        # Generate only, no upload"
	@echo "  make clean FILE=marco2         # Clean marco2 files"