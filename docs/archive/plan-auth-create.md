# Self-Registration with Admin Approval

Add a public registration flow where new users can request access. Registrations require admin approval before the user can log in. Includes a self-hosted captcha to prevent spam.

## Summary

- **Registration form**: Public page with email, name, and captcha
- **Pending queue**: Store registrations in DynamoDB until approved
- **Admin approval UI**: Tab in UserManagement to approve/reject
- **Email notifications**: Notify admins when new registration arrives
- **Captcha**: Self-hosted math challenge (no external dependencies)

---

## Implementation Steps

### 1. DynamoDB Table for Pending Registrations

**File**: `aws-backend/cloudformation/mosaic-infrastructure.yaml`

Add new table:
```yaml
PendingRegistrationsTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: !Sub '${Environment}-pending-registrations'
    BillingMode: PAY_PER_REQUEST
    AttributeDefinitions:
      - AttributeName: id
        AttributeType: S
    KeySchema:
      - AttributeName: id
        KeyType: HASH
    TimeToLiveSpecification:
      AttributeName: expires_at
      Enabled: true
```

Schema:
- `id`: UUID (partition key)
- `email`: string
- `name`: string
- `status`: PENDING | APPROVED | REJECTED
- `created_at`: ISO timestamp
- `expires_at`: TTL (30 days)

---

### 2. Backend Lambda Functions

**File**: `aws-backend/lambda/mosaic/registration.py` (new file)

Functions:
- `submit_registration(email, name, captcha_answer, captcha_id)` - Public endpoint
  - Validate captcha
  - Check email not already registered (Cognito) or pending
  - Create DynamoDB record with status=PENDING
  - Send notification email to admins
  - Return success message

- `list_pending()` - Admin endpoint
  - Query DynamoDB for status=PENDING
  - Return list of pending registrations

- `approve_registration(id)` - Admin endpoint
  - Update DynamoDB status to APPROVED
  - Create Cognito user via `admin_create_user()`
  - Cognito sends invitation email automatically

- `reject_registration(id)` - Admin endpoint
  - Update DynamoDB status to REJECTED
  - Optionally send rejection email

**File**: `aws-backend/lambda/mosaic/captcha.py` (new file)

Functions:
- `generate_captcha()` - Public endpoint
  - Generate simple math problem (e.g., "7 + 3 = ?")
  - Store answer in DynamoDB with short TTL (5 min)
  - Return captcha_id and question text

- `verify_captcha(captcha_id, answer)` - Internal helper
  - Check answer matches stored value
  - Delete captcha record after use

---

### 3. API Gateway Endpoints

**File**: `aws-backend/cloudformation/user-management.yaml`

Add public endpoints (no auth):
```
POST /register          -> registration.submit_registration
GET  /captcha           -> captcha.generate_captcha
```

Add admin endpoints (Cognito auth):
```
GET    /registrations           -> registration.list_pending
POST   /registrations/{id}/approve -> registration.approve_registration
POST   /registrations/{id}/reject  -> registration.reject_registration
```

---

### 4. Frontend: Public Registration Page

**File**: `admin-ui/src/pages/Register.tsx` (new file)

Components:
- Email input (required)
- Name input (required)
- Captcha display + answer input
- Submit button
- Success/error messages
- Link back to login page

Flow:
1. On mount, fetch captcha from `/captcha`
2. User fills form + captcha answer
3. Submit to `/register`
4. Show "Registration submitted, await approval" message

**File**: `admin-ui/src/App.tsx`

Add public route:
```tsx
<Route path="/register" element={<Register />} />
```

**File**: `admin-ui/src/pages/Login.tsx`

Add link to registration:
```tsx
<Link to="/register">Request access</Link>
```

---

### 5. Frontend: Admin Approval UI

**File**: `admin-ui/src/pages/UserManagement.tsx`

Add tab or section for pending registrations:
- Table showing: name, email, submitted date
- Approve button (creates user, sends invite)
- Reject button (with optional reason)
- Badge showing count of pending

**File**: `admin-ui/src/services/api.ts`

Add functions:
```typescript
export async function getCaptcha(): Promise<{id: string, question: string}>
export async function submitRegistration(data: {email: string, name: string, captcha_id: string, captcha_answer: string})
export async function listPendingRegistrations(): Promise<PendingRegistration[]>
export async function approveRegistration(id: string): Promise<void>
export async function rejectRegistration(id: string): Promise<void>
```

**File**: `admin-ui/src/types/api.ts`

Add types:
```typescript
export interface PendingRegistration {
  id: string;
  email: string;
  name: string;
  created_at: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}
```

---

### 6. Admin Email Notifications

**File**: `aws-backend/lambda/mosaic/registration.py`

In `submit_registration()`, after creating pending record:
- Query Cognito for all admin users
- Send email via SES to each admin
- Email contains: new registration details + link to approval page

Requires:
- SES verified sender identity (or use Cognito default email)
- IAM permissions for `ses:SendEmail`

---

### 7. Translations

**File**: `admin-ui/src/i18n/translations/en.ts` and `es.ts`

Add strings for:
- Registration form labels and placeholders
- Success/error messages
- Pending registrations table headers
- Approve/reject button labels

---

## Files to Modify

| File | Change |
|------|--------|
| `aws-backend/cloudformation/mosaic-infrastructure.yaml` | Add DynamoDB table, IAM permissions |
| `aws-backend/cloudformation/user-management.yaml` | Add API endpoints |
| `aws-backend/lambda/mosaic/registration.py` | New file - registration logic |
| `aws-backend/lambda/mosaic/captcha.py` | New file - captcha logic |
| `admin-ui/src/pages/Register.tsx` | New file - registration form |
| `admin-ui/src/pages/Login.tsx` | Add registration link |
| `admin-ui/src/pages/UserManagement.tsx` | Add pending approvals section |
| `admin-ui/src/services/api.ts` | Add API functions |
| `admin-ui/src/types/api.ts` | Add types |
| `admin-ui/src/App.tsx` | Add /register route |
| `admin-ui/src/i18n/translations/en.ts` | Add English translations |
| `admin-ui/src/i18n/translations/es.ts` | Add Spanish translations |

---

## Security Considerations

- Captcha prevents automated spam registrations
- Rate limiting on `/register` endpoint (API Gateway throttling)
- Email uniqueness check prevents duplicate registrations
- Pending records expire after 30 days (TTL)
- Admin approval required before any Cognito user created
