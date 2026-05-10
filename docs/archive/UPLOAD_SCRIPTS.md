# Mosaic Generation and Upload Makefile

## Usage Examples

### Quick Upload (uses your defaults)
```bash
make upload                        # Uses marco2
make upload FILE=myfile            # Uses myfile.jpeg
```

### Custom Configuration
```bash
# Override specific settings
make upload FILE=photo1 TILE_SIZE=16

# Different crop and opacity settings
make upload FILE=landscape CROP=0 OPACITY=50

# Custom tile directory
make upload TILES_DIR="/path/to/my/tiles"

# Different S3 bucket
make upload S3_BUCKET="my-other-bucket.com"

# Multiple overrides
make upload FILE=test TILE_SIZE=16 CROP=0 MODE=16
```

### Other Targets
```bash
make generate FILE=test            # Generate only, no upload
make help                          # Show help
```

## Configuration Variables

- `FILE` - Input filename (without .jpeg extension)
- `TILE_SIZE` - Size of each tile (default: 32)
- `MODE` - Mosaic mode (default: 32)
- `OPACITY` - Tint opacity (default: 0)
- `MORE` - Additional flags (default: "no-repeat downsample=4")
- `CROP` - Enable cropping (1=yes, 0=no, default: 1)
- `TILES_DIR` - Path to tile images directory
- `S3_BUCKET` - S3 bucket name (default: casadelmanco.com)
- `DOWNSAMPLE` -
- `OUTPUT_FOLDER` -

## What the script does

1. ✅ Creates output directory if needed
2. 🧩 Runs `cargo run --release` with your exact parameters
3. 📤 Uploads HTML widget as `index.html` to S3
4. 🖼️ Uploads JPEG image to S3
5. 🎨 Uploads CSS and JS assets to S3
6. ✅ Reports success/failure with clear messages

## Requirements

- AWS CLI configured with appropriate credentials
- Rust/Cargo installed
- Input JPEG file in `mosaico/` directory