#!/bin/bash
# Test script for Phase 3 API endpoints
# Tests: upload-url, set-main, list-jobs, get-mosaic with jobs, cancel-job

set -e

ENVIRONMENT=${ENVIRONMENT:-prod}
REGION=${AWS_REGION:-eu-west-3}

echo "🧪 Emosaic Phase 3 API Test"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo ""

# Check AWS CLI
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Run 'aws configure'."
    exit 1
fi

echo "✅ AWS CLI configured"
echo ""

# =============================================================================
# Get AWS Resources
# =============================================================================
echo "📋 Getting AWS resources..."

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
echo "   User Pool: $USER_POOL_ID"
echo ""

# =============================================================================
# Authentication
# =============================================================================
echo "🔐 Authenticating..."

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
    echo "❌ Authentication failed. Check your credentials."
    exit 1
fi

echo "✅ Authenticated"
echo ""

AUTH_HEADER="Authorization: Bearer $TOKEN"

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0

pass_test() {
    echo "   ✅ PASSED: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail_test() {
    echo "   ❌ FAILED: $1"
    echo "   Error: $2"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

# =============================================================================
# Test 1: Upload URL Generation
# =============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📤 Test 1: Upload URL Generation (POST /upload-url)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

UPLOAD_RESPONSE=$(curl -s -X POST "$API_URL/upload-url" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d '{
        "filename": "test-image.jpg",
        "content_type": "image/jpeg",
        "upload_type": "source"
    }')

UPLOAD_URL=$(echo "$UPLOAD_RESPONSE" | jq -r '.upload_url // empty')
S3_KEY=$(echo "$UPLOAD_RESPONSE" | jq -r '.s3_key // empty')

if [ -n "$UPLOAD_URL" ] && [ "$UPLOAD_URL" != "None" ]; then
    pass_test "Got presigned upload URL"
    echo "   S3 Key: $S3_KEY"
else
    fail_test "Upload URL generation" "$UPLOAD_RESPONSE"
fi
echo ""

# =============================================================================
# Test 2: List Jobs
# =============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Test 2: List Jobs (GET /jobs)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test 2a: List all jobs
JOBS_RESPONSE=$(curl -s "$API_URL/jobs" -H "$AUTH_HEADER")
JOBS_COUNT=$(echo "$JOBS_RESPONSE" | jq -r '.count // -1')

if [ "$JOBS_COUNT" != "-1" ]; then
    pass_test "List all jobs (found $JOBS_COUNT jobs)"
else
    fail_test "List all jobs" "$JOBS_RESPONSE"
fi

# Test 2b: List jobs with status filter
JOBS_SUCCEEDED=$(curl -s "$API_URL/jobs?status=succeeded" -H "$AUTH_HEADER")
SUCCEEDED_COUNT=$(echo "$JOBS_SUCCEEDED" | jq -r '.count // -1')

if [ "$SUCCEEDED_COUNT" != "-1" ]; then
    pass_test "List succeeded jobs (found $SUCCEEDED_COUNT)"
else
    fail_test "List jobs with status filter" "$JOBS_SUCCEEDED"
fi

# Test 2c: List jobs with limit
JOBS_LIMITED=$(curl -s "$API_URL/jobs?limit=5" -H "$AUTH_HEADER")
LIMITED_COUNT=$(echo "$JOBS_LIMITED" | jq '.jobs // [] | length')

if [ "$LIMITED_COUNT" -le 5 ]; then
    pass_test "List jobs with limit (returned $LIMITED_COUNT)"
else
    fail_test "List jobs with limit" "Returned more than 5 jobs"
fi
echo ""

# =============================================================================
# Test 3: List Mosaics and Get First Mosaic ID
# =============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🖼️  Test 3: Get Mosaic with Job History"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get list of mosaics to find one to test with
MOSAICS_RESPONSE=$(curl -s "$API_URL/mosaics" -H "$AUTH_HEADER")
FIRST_MOSAIC_ID=$(echo "$MOSAICS_RESPONSE" | jq -r '(.mosaics // .)[0].id // empty')

if [ -z "$FIRST_MOSAIC_ID" ] || [ "$FIRST_MOSAIC_ID" = "None" ]; then
    echo "   ⚠️  No mosaics found to test with. Skipping mosaic-specific tests."
else
    echo "   Using mosaic: $FIRST_MOSAIC_ID"

    # Test 3a: Get mosaic without job history
    MOSAIC_RESPONSE=$(curl -s "$API_URL/mosaics/$FIRST_MOSAIC_ID" -H "$AUTH_HEADER")
    MOSAIC_TITLE=$(echo "$MOSAIC_RESPONSE" | jq -r '.title // empty')

    if [ -n "$MOSAIC_TITLE" ]; then
        pass_test "Get mosaic details (title: $MOSAIC_TITLE)"
    else
        fail_test "Get mosaic details" "$MOSAIC_RESPONSE"
    fi

    # Test 3b: Get mosaic with job history
    MOSAIC_WITH_JOBS=$(curl -s "$API_URL/mosaics/$FIRST_MOSAIC_ID?include_jobs=true" -H "$AUTH_HEADER")
    HAS_JOBS_FIELD=$(echo "$MOSAIC_WITH_JOBS" | jq 'has("jobs")')

    if [ "$HAS_JOBS_FIELD" = "true" ]; then
        JOBS_IN_MOSAIC=$(echo "$MOSAIC_WITH_JOBS" | jq '.jobs // [] | length')
        pass_test "Get mosaic with job history ($JOBS_IN_MOSAIC jobs)"
    else
        fail_test "Get mosaic with job history" "Missing 'jobs' field in response"
    fi

    # Test 3c: List jobs for specific mosaic
    MOSAIC_JOBS=$(curl -s "$API_URL/jobs?mosaic_id=$FIRST_MOSAIC_ID" -H "$AUTH_HEADER")
    MOSAIC_JOBS_COUNT=$(echo "$MOSAIC_JOBS" | jq -r '.count // -1')

    if [ "$MOSAIC_JOBS_COUNT" != "-1" ]; then
        pass_test "List jobs by mosaic_id (found $MOSAIC_JOBS_COUNT)"
    else
        fail_test "List jobs by mosaic_id" "$MOSAIC_JOBS"
    fi
fi
echo ""

# =============================================================================
# Test 4: Set Main Mosaic
# =============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⭐ Test 4: Set Main Mosaic (PUT /mosaics/{id}/main)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -z "$FIRST_MOSAIC_ID" ] || [ "$FIRST_MOSAIC_ID" = "None" ]; then
    echo "   ⚠️  No mosaics found. Skipping set main test."
else
    # Test 4a: Set mosaic as main
    SET_MAIN_RESPONSE=$(curl -s -X PUT "$API_URL/mosaics/$FIRST_MOSAIC_ID/main?set_main=true" \
        -H "$AUTH_HEADER")

    SET_MAIN_MSG=$(echo "$SET_MAIN_RESPONSE" | jq -r '.message // empty')

    if echo "$SET_MAIN_MSG" | grep -q "main"; then
        pass_test "Set mosaic as main"
    else
        fail_test "Set mosaic as main" "$SET_MAIN_RESPONSE"
    fi

    # Verify it's set
    VERIFY_MAIN=$(curl -s "$API_URL/mosaics/$FIRST_MOSAIC_ID" -H "$AUTH_HEADER")
    IS_MAIN=$(echo "$VERIFY_MAIN" | jq -r '.is_main // 0')

    if [ "$IS_MAIN" = "1" ]; then
        pass_test "Verified is_main=1"
    else
        fail_test "Verify is_main flag" "Expected is_main=1, got $IS_MAIN"
    fi

    # Test 4b: Unset main
    UNSET_MAIN_RESPONSE=$(curl -s -X PUT "$API_URL/mosaics/$FIRST_MOSAIC_ID/main?set_main=false" \
        -H "$AUTH_HEADER")

    UNSET_MAIN_MSG=$(echo "$UNSET_MAIN_RESPONSE" | jq -r '.message // empty')

    if echo "$UNSET_MAIN_MSG" | grep -q "unset\|removed"; then
        pass_test "Unset main mosaic"
    else
        fail_test "Unset main mosaic" "$UNSET_MAIN_RESPONSE"
    fi
fi
echo ""

# =============================================================================
# Test 5: Cancel Job (Optional - requires active job)
# =============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🛑 Test 5: Cancel Job (DELETE /jobs/{id}/cancel)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Find a running or submitted job to cancel
ACTIVE_JOB=$(curl -s "$API_URL/jobs?status=submitted&limit=1" -H "$AUTH_HEADER")
ACTIVE_JOB_ID=$(echo "$ACTIVE_JOB" | jq -r '.jobs[0].id // empty')

if [ -z "$ACTIVE_JOB_ID" ] || [ "$ACTIVE_JOB_ID" = "None" ]; then
    # Try running jobs
    ACTIVE_JOB=$(curl -s "$API_URL/jobs?status=running&limit=1" -H "$AUTH_HEADER")
    ACTIVE_JOB_ID=$(echo "$ACTIVE_JOB" | jq -r '.jobs[0].id // empty')
fi

if [ -z "$ACTIVE_JOB_ID" ] || [ "$ACTIVE_JOB_ID" = "None" ]; then
    echo "   ⚠️  No active jobs found to cancel. Testing error handling instead."

    # Test cancelling a non-existent job
    CANCEL_RESPONSE=$(curl -s -X DELETE "$API_URL/jobs/non-existent-job-id/cancel" \
        -H "$AUTH_HEADER")

    CANCEL_ERROR=$(echo "$CANCEL_RESPONSE" | jq -r '.error // empty')

    if [ "$CANCEL_ERROR" = "Not found" ]; then
        pass_test "Cancel non-existent job returns 404"
    else
        fail_test "Cancel error handling" "$CANCEL_RESPONSE"
    fi
else
    echo "   Found active job: $ACTIVE_JOB_ID"

    CANCEL_RESPONSE=$(curl -s -X DELETE "$API_URL/jobs/$ACTIVE_JOB_ID/cancel" \
        -H "$AUTH_HEADER")

    CANCEL_MSG=$(echo "$CANCEL_RESPONSE" | jq -r '.message // empty')

    if echo "$CANCEL_MSG" | grep -qi "cancel"; then
        pass_test "Cancel active job"
    else
        fail_test "Cancel active job" "$CANCEL_RESPONSE"
    fi
fi
echo ""

# =============================================================================
# Test 6: CORS Headers
# =============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 Test 6: CORS Headers (OPTIONS request)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

CORS_HEADERS=$(curl -s -I -X OPTIONS "$API_URL/mosaics" \
    -H "Origin: http://localhost:5173" \
    -H "Access-Control-Request-Method: GET" 2>&1)

if echo "$CORS_HEADERS" | grep -qi "access-control-allow-origin"; then
    pass_test "CORS headers present"
else
    fail_test "CORS headers" "Missing Access-Control-Allow-Origin header"
fi
echo ""

# =============================================================================
# Summary
# =============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Test Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   Passed: $TESTS_PASSED"
echo "   Failed: $TESTS_FAILED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo "✅ All Phase 3 tests passed!"
    exit 0
else
    echo "❌ Some tests failed. Review the output above."
    exit 1
fi
