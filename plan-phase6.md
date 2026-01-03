# Phase 6: Dynamic Landing Page with Main Mosaic Selection

## Goal
Enable the public landing page (`/`) to automatically display whichever mosaic is marked as "main" in the Admin UI.

## Problem
Currently, `is_main` flag in DynamoDB is disconnected from the public landing page:
- Admin UI can set `is_main=1` via `PUT /mosaics/{id}/main`
- But `index.html` is a static file manually deployed via `make deploy`
- No mechanism connects these two

## Solution: Lambda Trigger (Option A)

When admin sets a mosaic as main, a Lambda function:
1. Copies the widget HTML content to `index.html` in S3
2. Invalidates the CloudFront cache for `/index.html`

**Why this works:**
- Widget HTML uses relative paths: `src="marco2.png"`, `href="mosaic-widget.css"`
- All mosaic files are already in S3 root alongside `index.html`
- Relative paths resolve correctly when served from `/`

---

## Implementation Steps

### Step 1: Enhance set_main_mosaic Lambda

**File:** `aws-backend/lambda/mosaic/set_main_mosaic.py`

Add after setting `is_main=1` in DynamoDB:
```python
# 1. Get the widget HTML path from mosaic record
widget_key = f"{mosaic['s3_path']}_widget.html"

# 2. Copy widget content to index.html
s3.copy_object(
    Bucket=bucket,
    CopySource={'Bucket': bucket, 'Key': widget_key},
    Key='index.html',
    ContentType='text/html',
    MetadataDirective='REPLACE'
)

# 3. Invalidate CloudFront cache
cloudfront.create_invalidation(
    DistributionId=distribution_id,
    InvalidationBatch={
        'Paths': {'Quantity': 1, 'Items': ['/index.html', '/']},
        'CallerReference': str(time.time())
    }
)
```

### Step 2: Update IAM Role Permissions

**File:** `aws-backend/cloudformation/mosaic-infrastructure.yaml`

Add to `MosaicLambdaRole`:
```yaml
- Effect: Allow
  Action:
    - s3:CopyObject
    - s3:PutObject
  Resource: !Sub 'arn:aws:s3:::${TilesBucket}/*'
- Effect: Allow
  Action:
    - cloudfront:CreateInvalidation
  Resource: !Sub 'arn:aws:cloudfront::${AWS::AccountId}:distribution/*'
```

### Step 3: Add Environment Variables

**File:** `aws-backend/cloudformation/phase3-enhancements.yaml`

Add to `SetMainMosaicFunction` environment:
```yaml
Environment:
  Variables:
    MOSAICS_TABLE: ...
    CORS_ORIGIN: ...
    S3_BUCKET: !ImportValue ...
    CLOUDFRONT_DISTRIBUTION_ID: !Ref DistributionId  # Need to pass this
```

### Step 4: Update Deployment Script

**File:** `aws-backend/deploy-cloud.sh`

Pass CloudFront distribution ID to the stack deployment.

---

## Files to Modify

| File | Changes |
|------|---------|
| `aws-backend/lambda/mosaic/set_main_mosaic.py` | Add S3 copy + CloudFront invalidation |
| `aws-backend/cloudformation/mosaic-infrastructure.yaml` | Add S3/CloudFront permissions to IAM role |
| `aws-backend/cloudformation/phase3-enhancements.yaml` | Add S3_BUCKET and CLOUDFRONT_DISTRIBUTION_ID env vars |
| `aws-backend/deploy-cloud.sh` | Pass distribution ID parameter |

---

## How It Works

```
Admin clicks "Set as Main" in Admin UI
    ↓
PUT /mosaics/{id}/main
    ↓
set_main_mosaic Lambda:
    1. Updates DynamoDB: is_main = 1
    2. Copies {id}_widget.html → index.html in S3
    3. Creates CloudFront invalidation for /index.html
    ↓
User visits casadelmanco.com
    ↓
CloudFront serves index.html (which IS the widget HTML)
    ↓
Browser loads relative assets: mosaic.png, mosaic-widget.css, mosaic-widget.js
```

---

## Asset Path Resolution

Mosaic widget HTML contains relative paths:
```html
<link rel="stylesheet" href="mosaic-widget.css">
<script src="mosaic-widget.js"></script>
<img src="marco2.png">
```

S3 bucket structure:
```
s3://casadelmanco.com/
├── index.html          ← copied from marco2_widget.html
├── marco2.png          ← mosaic image
├── marco2_widget.html  ← original widget
├── mosaic-widget.css   ← shared CSS
├── mosaic-widget.js    ← shared JS
└── ...
```

When browser loads `/index.html`, relative paths resolve to:
- `/mosaic-widget.css` ✓
- `/mosaic-widget.js` ✓
- `/marco2.png` ✓

---

## Caching Strategy

| Resource | Cache-Control | Notes |
|----------|---------------|-------|
| `index.html` | Short TTL or invalidated | Changes when main mosaic changes |
| Widget HTML | Long TTL | Stable, rarely accessed directly |
| Mosaic images | Long TTL | Immutable after generation |
| CSS/JS assets | Long TTL | Shared, rarely change |

CloudFront invalidation ensures immediate propagation (typically <30 seconds).

---

## Testing Plan

1. Deploy updated Lambda with S3/CloudFront permissions
2. Set mosaic X as main via Admin UI
3. Check S3: verify `index.html` matches `{X}_widget.html`
4. Check CloudFront: verify invalidation was created
5. Load `https://casadelmanco.com/` in browser
6. Verify mosaic X displays correctly
7. Set mosaic Y as main
8. Verify landing page updates to mosaic Y

---

## Error Handling

In `set_main_mosaic.py`:
- If S3 copy fails: Log error, return 500, don't leave inconsistent state
- If CloudFront invalidation fails: Log warning but don't fail (mosaic is set, just cached)
- If widget HTML doesn't exist: Return 400 with clear error message

---

## Rollback

If issues occur:
1. Manually copy desired widget to index.html:
   ```bash
   aws s3 cp s3://bucket/marco2_widget.html s3://bucket/index.html
   ```
2. Or use `make deploy FILE=...` to restore old workflow
