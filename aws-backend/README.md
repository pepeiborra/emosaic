# 🚀 Tile Flagging System - AWS Backend

This directory contains the AWS infrastructure and deployment scripts for the mosaic tile flagging system.

## 📋 Prerequisites

- AWS CLI installed and configured
- Appropriate AWS permissions for:
  - CloudFormation
  - DynamoDB
  - Lambda
  - API Gateway
  - IAM

## 🏗️ Infrastructure

### Architecture
```
Frontend (S3) → API Gateway → Lambda → DynamoDB
                     ↓
                Rate Limiting
```

### Resources Created
- **DynamoDB Tables**:
  - `prod-tile-flags`: Stores tile flag data
  - `prod-rate-limits`: Handles rate limiting (TTL enabled)
- **Lambda Functions**:
  - `prod-toggle-tile-flag`: Flag/unflag tiles
  - `prod-get-tile-flags`: Bulk flag retrieval
  - `prod-admin-get-all-flags`: Admin API for retrieving all flags
- **API Gateway**: RESTful API with CORS support
- **IAM Roles**: Proper permissions for Lambda→DynamoDB

## 🚀 Deployment

### Step 1: Deploy Infrastructure
```bash
cd aws-backend
./deploy.sh
```

This will:
1. Package Lambda functions
2. Deploy CloudFormation stacks
3. Update Lambda code
4. Test API endpoints
5. Output the API Gateway URL

### Step 2: Update Frontend
```bash
./update-api-endpoint.sh
```

This automatically updates the `mosaic-widget.js` file with the correct API endpoint.

### Step 3: Redeploy Frontend
```bash
cd ..
make upload
```

## 🔧 Configuration

### Environment Variables
- `ENVIRONMENT`: Deployment environment (default: `prod`)
- `AWS_REGION`: AWS region (default: `us-east-1`)
- `CORS_ORIGIN`: Allowed CORS origin (default: `https://casadelmanco.com`)

### Custom Deployment
```bash
# Deploy to staging environment
ENVIRONMENT=staging ./deploy.sh

# Deploy to different region
AWS_REGION=us-west-2 ./deploy.sh

# Custom CORS origin
CORS_ORIGIN=https://mydomain.com ./deploy.sh
```

## 📡 API Endpoints

Base URL: `https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod`

### Flag a Tile
```http
POST /tiles/{tileHash}/flag
Content-Type: application/json

{
  "tilePath": "/path/to/tile.jpg"
}
```

### Unflag a Tile
```http
DELETE /tiles/{tileHash}/flag
```

### Get Bulk Flags
```http
POST /tiles/flags
Content-Type: application/json

{
  "tileHashes": ["hash1", "hash2", ...]
}
```

### Admin: Get All Flags
```http
GET /admin/flags?limit=100&lastKey=...
```

**Response:**
```json
{
  "success": true,
  "flags": [
    {
      "tileHash": "abc123",
      "tilePath": "/path/to/tile.jpg",
      "flaggedAt": "2025-08-27T09:01:50.375576",
      "flagStatus": "flagged",
      "ttl": 1758877310
    }
  ],
  "count": 1,
  "hasMore": false,
  "nextKey": "eyJ0aWxlX2hhc2giOiAiYWJjMTIzIn0=",
  "summary": {
    "total": 1,
    "today": 1,
    "thisWeek": 1,
    "retrievedAt": "2025-08-27T09:06:49.523600Z"
  }
}
```

**Query Parameters:**
- `limit`: Number of results (default 100, max 1000)
- `lastKey`: Pagination token for next page

## 🔒 Rate Limiting

- **Client-side**: 10 flags per minute (JavaScript)
- **Server-side**: DynamoDB-based IP tracking
- **API Gateway**: 10 RPS baseline, 20 burst

## 📊 Monitoring

### CloudWatch Logs
- `/aws/lambda/prod-toggle-tile-flag`
- `/aws/lambda/prod-get-tile-flags`
- `/aws/lambda/prod-admin-get-all-flags`

### DynamoDB Metrics
- Read/Write capacity usage
- Throttled requests
- Item counts

## 🧪 Testing

### Manual Testing
```bash
# Test flagging
curl -X POST "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/tiles/test123/flag" \
  -H "Content-Type: application/json" \
  -d '{"tilePath": "/test/path.jpg"}'

# Test bulk retrieval
curl -X POST "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/tiles/flags" \
  -H "Content-Type: application/json" \
  -d '{"tileHashes": ["test123"]}'

# Test admin API (get all flags)
curl -X GET "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/admin/flags?limit=10"
```

### Load Testing
```bash
# Install artillery if needed
npm install -g artillery

# Run load test
artillery quick --count 10 --num 50 "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod/tiles/flags"
```

## 🛠️ Troubleshooting

### Common Issues

1. **CORS Errors**
   - Check the `CORS_ORIGIN` parameter matches your domain
   - Verify OPTIONS methods are deployed

2. **Rate Limiting Issues**
   - Check CloudWatch logs for rate limit messages
   - Monitor DynamoDB `rate-limits` table

3. **Lambda Timeout**
   - Check CloudWatch logs for timeout errors
   - Consider increasing timeout in CloudFormation

4. **API Gateway 502/503**
   - Check Lambda function logs
   - Verify IAM permissions

### Useful Commands
```bash
# Check stack status
aws cloudformation describe-stacks --stack-name prod-tile-flags-infrastructure

# View Lambda logs
aws logs tail /aws/lambda/prod-toggle-tile-flag --follow

# Check DynamoDB items
aws dynamodb scan --table-name prod-tile-flags --region us-east-1 --max-items 10
```

## 💰 Cost Optimization

- **DynamoDB**: Pay-per-request pricing (cost scales with usage)
- **Lambda**: Free tier covers ~1M requests/month
- **API Gateway**: Free tier covers first 1M requests
- **Estimated cost**: $2-10/month for moderate usage

## 🛠️ CLI Management Tool

A Python CLI tool is provided for managing flagged tiles directly from the command line.

### Installation

```bash
cd aws-backend
pip install -r requirements.txt
```

### Usage

```bash
# List all flagged tiles (default: 100 items)
python tile_manager.py list

# List with custom limit and output format
python tile_manager.py list --limit 50 --format json

# List with pagination (use nextKey from previous response)
python tile_manager.py list --next-key "eyJ0aWxlX2hhc2giOiAiYWJjMTIzIn0="

# Delete specific tiles (with confirmation)
python tile_manager.py delete abc123 def456 ghi789

# Delete tiles without confirmation prompt
python tile_manager.py delete abc123 --confirm

# Interactive review of flagged tiles
python tile_manager.py review

# Review with custom batch size
python tile_manager.py review --batch-size 20

# Use different environment or region
python tile_manager.py --environment staging --region us-west-2 list
```

### Commands

#### `list` - List Flagged Tiles
- `--limit, -l`: Number of items to return (max 1000, default 100)
- `--next-key, -n`: Pagination token for next page
- `--format, -f`: Output format (`table` or `json`, default table)

#### `review` - Interactive Review
Interactively review flagged tiles one by one with options to:
- **Open**: View the image file in your default image viewer
- **Unflag**: Remove the tile from the flagged list (keeps the file)
- **Delete**: Delete the image file from disk (also unflags it)
- **Continue**: Skip to the next tile
- **Quit**: Exit the review session

Options:
- `--batch-size, -b`: Number of tiles to fetch per batch (default 50)

#### `delete` - Delete Flagged Tiles  
- `tile_hashes`: One or more tile hashes to delete
- `--confirm, -y`: Skip confirmation prompt

### Global Options
- `--environment, -e`: Environment name (default: prod)
- `--region, -r`: AWS region (default: us-east-1)

### Example Output

```bash
$ python tile_manager.py list --limit 5

📊 Summary:
  Total flags: 3
  Today: 1
  This week: 2
  Retrieved at: 2025-08-27T10:30:00Z

🏷️  Flagged Tiles (showing 3 of 3 scanned):
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Tile Hash            Flagged At                Tile Path                                                     Status    
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
abc123               2025-08-27T09:01:50       /tiles/2019/tile_001.jpg                                     flagged   
def456               2025-08-26T15:30:25       /tiles/2020/tile_002.jpg                                     flagged   
ghi789               2025-08-25T12:15:10       /tiles/2021/tile_003.jpg                                     flagged   
```

## 🧹 Cleanup

```bash
# Delete all resources
aws cloudformation delete-stack --stack-name prod-tile-flags-api
aws cloudformation delete-stack --stack-name prod-tile-flags-infrastructure
```

## 📝 Next Steps

1. **Admin Panel**: Create web interface using the admin API for reviewing flags
2. **Authentication**: Add proper authentication/authorization for admin endpoints
3. **Analytics**: Add metrics for flag patterns and trends
4. **Notifications**: Alert on high flag volumes
5. **Auto-moderation**: ML-based automatic flagging