# Multi-stage Dockerfile for emosaic
# Stage 1: Build the Rust binary
FROM rust:1.75-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy manifests
COPY Cargo.toml Cargo.lock ./
COPY rust-toolchain.toml ./

# Copy source code
COPY src ./src

# Build release binary
RUN cargo build --release

# Stage 2: Runtime image
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI v2 for S3 operations
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws

# Create app user
RUN useradd -m -u 1000 emosaic

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/target/release/emosaic /app/emosaic

# Copy entrypoint script
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create directories for tile cache and outputs
RUN mkdir -p /app/tiles /app/output /app/tmp && \
    chown -R emosaic:emosaic /app

USER emosaic

# Set environment variables
ENV RUST_BACKTRACE=1
ENV TILES_DIR=/app/tiles
ENV OUTPUT_DIR=/app/output
ENV TMP_DIR=/app/tmp

ENTRYPOINT ["/app/entrypoint.sh"]
