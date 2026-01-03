#!/bin/bash
# Test script for Emosaic API endpoints
# Can run individual tests or all tests
# Usage: ./test-api.sh [test_name] [environment]
#   test_name: Optional - specific test to run (e.g., tiles-folders, tile-count)
#   environment: Optional - defaults to 'prod'

set -e

TEST_NAME=${1:-all}
ENVIRONMENT=${2:-${ENVIRONMENT:-prod}}
REGION=${AWS_REGION:-eu-west-3}

echo "========================================================================"
echo "  Emosaic API Test Suite"
echo "========================================================================"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "Test: $TEST_NAME"
echo ""

# =============================================================================
# Setup: Get AWS Resources and Authenticate
# =============================================================================

# Check AWS CLI
if ! aws sts get-caller-identity &> /dev/null; then
    echo "AWS credentials not configured. Run 'aws configure'."
    exit 1
fi

echo "Getting AWS resources..."

API_URL=$(aws cloudformation describe-stacks \
    --stack-name "$ENVIRONMENT-tile-flags-infrastructure" \
    --query "Stacks[0].Outputs[?OutputKey=='APIGatewayURL'].OutputValue" \
    --output text --region "$REGION")

BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "$ENVIRONMENT-mosaic-infrastructure" \
    --query "Stacks[0].Outputs[?OutputKey=='TilesBucketName'].OutputValue" \
    --output text --region "$REGION")

USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name "$ENVIRONMENT-mosaic-infrastructure" \
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
    --output text --region "$REGION")

CLIENT_ID=$(aws cloudformation describe-stacks \
    --stack-name "$ENVIRONMENT-mosaic-infrastructure" \
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
    --output text --region "$REGION")

echo "   API URL: $API_URL"
echo "   S3 Bucket: $BUCKET"
echo ""

# =============================================================================
# Authentication
# =============================================================================
echo "Authenticating..."

if [ -z "$COGNITO_USERNAME" ] || [ -z "$COGNITO_PASSWORD" ]; then
    echo "   Set COGNITO_USERNAME and COGNITO_PASSWORD environment variables"
    echo "   or enter them now:"
    read -p "   Username (email): " COGNITO_USERNAME
    read -s -p "   Password: " COGNITO_PASSWORD
    echo ""
fi

AUTH_PARAMS=$(printf '{"USERNAME":"%s","PASSWORD":"%s"}' "$COGNITO_USERNAME" "$COGNITO_PASSWORD")
TOKEN=$(aws cognito-idp initiate-auth \
    --client-id "$CLIENT_ID" \
    --auth-flow USER_PASSWORD_AUTH \
    --auth-parameters "$AUTH_PARAMS" \
    --query "AuthenticationResult.IdToken" \
    --output text \
    --region $REGION 2>/dev/null)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "None" ]; then
    echo "Authentication failed. Check your credentials."
    exit 1
fi

echo "Authenticated successfully"
echo ""

AUTH_HEADER="Authorization: Bearer $TOKEN"

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0

pass_test() {
    echo "   PASSED: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail_test() {
    echo "   FAILED: $1"
    echo "   Error: $2"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

# =============================================================================
# Test Functions
# =============================================================================

test_tiles_folders() {
    echo "========================================================================"
    echo "  Test: List Tile Folders (GET /tiles/folders)"
    echo "========================================================================"

    # Test 1: List all folders
    echo ""
    echo "1. List all tile folders..."
    RESPONSE=$(curl -s "$API_URL/tiles/folders" -H "$AUTH_HEADER")

    echo "   Response (truncated): $(echo "$RESPONSE" | head -c 500)..."

    FOLDERS_COUNT=$(echo "$RESPONSE" | jq -r '.count // -1')
    HAS_FOLDERS=$(echo "$RESPONSE" | jq 'has("folders")')
    PREFIX=$(echo "$RESPONSE" | jq -r '.prefix // empty')

    if [ "$HAS_FOLDERS" = "true" ] && [ "$FOLDERS_COUNT" != "-1" ]; then
        pass_test "List folders returned $FOLDERS_COUNT folders (including nested)"
        echo "   Prefix: $PREFIX"

        # Show first few top-level folder names
        echo "   Top-level folders:"
        echo "$RESPONSE" | jq -r '.folders[:5][] | "      - \(.name)"'
        TOP_LEVEL_COUNT=$(echo "$RESPONSE" | jq '.folders | length')
        if [ "$TOP_LEVEL_COUNT" -gt 5 ]; then
            echo "      ... and $((TOP_LEVEL_COUNT - 5)) more top-level folders"
        fi
    else
        fail_test "List tile folders" "$RESPONSE"
    fi
    echo ""

    # Test 2: List folders with custom prefix
    echo "2. List folders with custom prefix..."
    RESPONSE=$(curl -s "$API_URL/tiles/folders?prefix=tiles/" -H "$AUTH_HEADER")

    FOLDERS_COUNT=$(echo "$RESPONSE" | jq -r '.count // -1')
    PREFIX=$(echo "$RESPONSE" | jq -r '.prefix // empty')

    if [ "$PREFIX" = "tiles/" ] && [ "$FOLDERS_COUNT" != "-1" ]; then
        pass_test "Custom prefix returns correct prefix ($PREFIX)"
    else
        fail_test "Custom prefix" "$RESPONSE"
    fi
    echo ""

    # Test 3: Verify folder structure (name, prefix)
    echo "3. Verify folder structure..."
    FIRST_FOLDER=$(echo "$RESPONSE" | jq -r '.folders[0] // empty')

    if [ -n "$FIRST_FOLDER" ] && [ "$FIRST_FOLDER" != "null" ]; then
        FOLDER_NAME=$(echo "$FIRST_FOLDER" | jq -r '.name // empty')
        FOLDER_PREFIX=$(echo "$FIRST_FOLDER" | jq -r '.prefix // empty')

        if [ -n "$FOLDER_NAME" ] && [ -n "$FOLDER_PREFIX" ]; then
            pass_test "Folder has name ($FOLDER_NAME) and prefix ($FOLDER_PREFIX)"
        else
            fail_test "Folder structure" "Missing name or prefix: $FIRST_FOLDER"
        fi
    else
        echo "   Skipped: No folders available to verify structure"
    fi
    echo ""

    # Test 4: Verify nested children structure (tree)
    echo "4. Verify nested children structure..."
    # Find a folder that has children
    FOLDER_WITH_CHILDREN=$(echo "$RESPONSE" | jq -r '.folders[] | select(.children != null and (.children | length) > 0) | .name' | head -1)

    if [ -n "$FOLDER_WITH_CHILDREN" ]; then
        CHILDREN_COUNT=$(echo "$RESPONSE" | jq -r ".folders[] | select(.name == \"$FOLDER_WITH_CHILDREN\") | .children | length")
        FIRST_CHILD_NAME=$(echo "$RESPONSE" | jq -r ".folders[] | select(.name == \"$FOLDER_WITH_CHILDREN\") | .children[0].name")

        if [ "$CHILDREN_COUNT" -gt 0 ] && [ -n "$FIRST_CHILD_NAME" ]; then
            pass_test "Folder '$FOLDER_WITH_CHILDREN' has $CHILDREN_COUNT children (first: $FIRST_CHILD_NAME)"
        else
            fail_test "Nested structure" "Children array exists but is malformed"
        fi
    else
        echo "   Skipped: No folders with children found (flat structure)"
    fi
    echo ""

    # Test 5: Test max_depth parameter
    echo "5. Test max_depth parameter..."
    RESPONSE_DEPTH1=$(curl -s "$API_URL/tiles/folders?max_depth=1" -H "$AUTH_HEADER")

    DEPTH1_COUNT=$(echo "$RESPONSE_DEPTH1" | jq -r '.count // -1')

    if [ "$DEPTH1_COUNT" != "-1" ]; then
        # With max_depth=1, we should have fewer or equal folders than unlimited depth
        if [ "$DEPTH1_COUNT" -le "$FOLDERS_COUNT" ]; then
            pass_test "max_depth=1 returns $DEPTH1_COUNT folders (<= $FOLDERS_COUNT)"
        else
            fail_test "max_depth parameter" "Depth-limited count ($DEPTH1_COUNT) > full count ($FOLDERS_COUNT)"
        fi
    else
        fail_test "max_depth parameter" "$RESPONSE_DEPTH1"
    fi
    echo ""
}

test_tile_count() {
    echo "========================================================================"
    echo "  Test: Tile Count (GET /tiles/count)"
    echo "========================================================================"

    # Test 1: Get total tile count
    echo ""
    echo "1. Get total tile count..."
    RESPONSE=$(curl -s "$API_URL/tiles/count" -H "$AUTH_HEADER")

    echo "   Response: $RESPONSE"

    COUNT=$(echo "$RESPONSE" | jq -r '.count // -1')
    PREFIX=$(echo "$RESPONSE" | jq -r '.prefix // empty')

    if [ "$COUNT" != "-1" ]; then
        pass_test "Total tile count: $COUNT"
        echo "   Prefix: $PREFIX"
    else
        fail_test "Get tile count" "$RESPONSE"
    fi
    echo ""

    # Test 2: Get tile count with exclusions
    echo "2. Get tile count with excluded folders..."

    # First get a folder name to exclude
    FOLDERS_RESPONSE=$(curl -s "$API_URL/tiles/folders" -H "$AUTH_HEADER")
    FIRST_FOLDER=$(echo "$FOLDERS_RESPONSE" | jq -r '.folders[0].name // empty')

    if [ -n "$FIRST_FOLDER" ] && [ "$FIRST_FOLDER" != "null" ]; then
        RESPONSE=$(curl -s "$API_URL/tiles/count?excluded=$FIRST_FOLDER" -H "$AUTH_HEADER")

        EXCLUDED_COUNT=$(echo "$RESPONSE" | jq -r '.count // -1')
        EXCLUDED_FOLDERS=$(echo "$RESPONSE" | jq -r '.excluded_folders // []')

        if [ "$EXCLUDED_COUNT" != "-1" ]; then
            pass_test "Tile count with exclusion: $EXCLUDED_COUNT (excluded: $FIRST_FOLDER)"

            # Verify count is less than or equal to total
            if [ "$EXCLUDED_COUNT" -le "$COUNT" ]; then
                pass_test "Excluded count ($EXCLUDED_COUNT) <= total count ($COUNT)"
            else
                fail_test "Count comparison" "Excluded count should be <= total"
            fi
        else
            fail_test "Tile count with exclusion" "$RESPONSE"
        fi
    else
        echo "   Skipped: No folders available to test exclusion"
    fi
    echo ""

    # Test 3: Get tile count with multiple exclusions
    echo "3. Get tile count with multiple excluded folders..."

    SECOND_FOLDER=$(echo "$FOLDERS_RESPONSE" | jq -r '.folders[1].name // empty')

    if [ -n "$FIRST_FOLDER" ] && [ -n "$SECOND_FOLDER" ] && [ "$SECOND_FOLDER" != "null" ]; then
        RESPONSE=$(curl -s "$API_URL/tiles/count?excluded=$FIRST_FOLDER,$SECOND_FOLDER" -H "$AUTH_HEADER")

        MULTI_EXCLUDED_COUNT=$(echo "$RESPONSE" | jq -r '.count // -1')

        if [ "$MULTI_EXCLUDED_COUNT" != "-1" ]; then
            pass_test "Tile count with multiple exclusions: $MULTI_EXCLUDED_COUNT"

            if [ "$MULTI_EXCLUDED_COUNT" -le "$EXCLUDED_COUNT" ]; then
                pass_test "Multi-exclusion count ($MULTI_EXCLUDED_COUNT) <= single exclusion ($EXCLUDED_COUNT)"
            else
                fail_test "Multi-exclusion comparison" "Should be <= single exclusion count"
            fi
        else
            fail_test "Tile count with multiple exclusions" "$RESPONSE"
        fi
    else
        echo "   Skipped: Not enough folders to test multiple exclusions"
    fi
    echo ""
}

test_mosaics() {
    echo "========================================================================"
    echo "  Test: Mosaics (GET/POST /mosaics)"
    echo "========================================================================"

    # Test 1: List mosaics
    echo ""
    echo "1. List mosaics..."
    RESPONSE=$(curl -s "$API_URL/mosaics" -H "$AUTH_HEADER")

    MOSAICS_COUNT=$(echo "$RESPONSE" | jq -r '.count // -1')
    HAS_MOSAICS=$(echo "$RESPONSE" | jq 'has("mosaics")')

    if [ "$HAS_MOSAICS" = "true" ]; then
        pass_test "List mosaics returned $MOSAICS_COUNT mosaics"
    else
        fail_test "List mosaics" "$RESPONSE"
    fi
    echo ""

    # Test 2: Get specific mosaic
    echo "2. Get specific mosaic..."
    FIRST_MOSAIC_ID=$(echo "$RESPONSE" | jq -r '(.mosaics // .)[0].id // empty')

    if [ -n "$FIRST_MOSAIC_ID" ] && [ "$FIRST_MOSAIC_ID" != "null" ]; then
        MOSAIC_RESPONSE=$(curl -s "$API_URL/mosaics/$FIRST_MOSAIC_ID" -H "$AUTH_HEADER")
        MOSAIC_ID=$(echo "$MOSAIC_RESPONSE" | jq -r '.id // empty')

        if [ "$MOSAIC_ID" = "$FIRST_MOSAIC_ID" ]; then
            pass_test "Get mosaic by ID"
        else
            fail_test "Get mosaic by ID" "$MOSAIC_RESPONSE"
        fi
    else
        echo "   Skipped: No mosaics available"
    fi
    echo ""
}

test_jobs() {
    echo "========================================================================"
    echo "  Test: Jobs (GET /jobs)"
    echo "========================================================================"

    # Test 1: List all jobs
    echo ""
    echo "1. List all jobs..."
    RESPONSE=$(curl -s "$API_URL/jobs" -H "$AUTH_HEADER")

    JOBS_COUNT=$(echo "$RESPONSE" | jq -r '.count // -1')
    HAS_JOBS=$(echo "$RESPONSE" | jq 'has("jobs")')

    if [ "$HAS_JOBS" = "true" ]; then
        pass_test "List jobs returned $JOBS_COUNT jobs"
    else
        fail_test "List jobs" "$RESPONSE"
    fi
    echo ""

    # Test 2: List jobs with status filter
    echo "2. List jobs with status filter..."
    RESPONSE=$(curl -s "$API_URL/jobs?status=succeeded" -H "$AUTH_HEADER")

    SUCCEEDED_COUNT=$(echo "$RESPONSE" | jq -r '.count // -1')

    if [ "$SUCCEEDED_COUNT" != "-1" ]; then
        pass_test "List succeeded jobs: $SUCCEEDED_COUNT"
    else
        fail_test "List jobs with status filter" "$RESPONSE"
    fi
    echo ""
}

test_upload_url() {
    echo "========================================================================"
    echo "  Test: Upload URL (POST /upload-url)"
    echo "========================================================================"

    echo ""
    echo "1. Get presigned upload URL..."
    RESPONSE=$(curl -s -X POST "$API_URL/upload-url" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d '{
            "filename": "test-image.jpg",
            "content_type": "image/jpeg"
        }')

    UPLOAD_URL=$(echo "$RESPONSE" | jq -r '.upload_url // empty')
    S3_KEY=$(echo "$RESPONSE" | jq -r '.s3_key // empty')

    if [ -n "$UPLOAD_URL" ] && [ "$UPLOAD_URL" != "null" ]; then
        pass_test "Got presigned upload URL"
        echo "   S3 Key: $S3_KEY"
    else
        fail_test "Get upload URL" "$RESPONSE"
    fi
    echo ""
}

# =============================================================================
# Run Tests
# =============================================================================

run_all_tests() {
    test_tiles_folders
    test_tile_count
    test_mosaics
    test_jobs
    test_upload_url
}

case "$TEST_NAME" in
    tiles-folders)
        test_tiles_folders
        ;;
    tile-count)
        test_tile_count
        ;;
    mosaics)
        test_mosaics
        ;;
    jobs)
        test_jobs
        ;;
    upload-url)
        test_upload_url
        ;;
    all)
        run_all_tests
        ;;
    *)
        echo "Unknown test: $TEST_NAME"
        echo "Available tests: tiles-folders, tile-count, mosaics, jobs, upload-url, all"
        exit 1
        ;;
esac

# =============================================================================
# Summary
# =============================================================================
echo "========================================================================"
echo "  Test Summary"
echo "========================================================================"
echo ""
echo "   Passed: $TESTS_PASSED"
echo "   Failed: $TESTS_FAILED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo "All tests passed!"
    exit 0
else
    echo "Some tests failed. Review the output above."
    exit 1
fi
