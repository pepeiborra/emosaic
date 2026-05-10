# Phase 4: Admin UI Browser Tests

Manual browser tests for the Emosaic Admin UI. Run these after starting the dev server with `npm run dev`.

## Prerequisites

- [x] Backend deployed (`ENVIRONMENT=rc ./deploy-cloud.sh`)
- [x] `.env` configured (`./generate-env.sh rc eu-west-3`)
- [x] Dev server running (`npm run dev`)
- [x] Admin user created in Cognito with known credentials

---

## Test 1: Login Page

**URL:** http://localhost:5173/login

### 1.1 Page Load
- [x] Login page loads without errors
- [x] "Emosaic Admin" title displayed
- [x] Email and password fields visible
- [x] "Sign in" button visible

### 1.2 Validation
- [x] Empty form submission shows browser validation
- [x] Invalid email format rejected

### 1.3 Authentication Errors
- [x] Wrong password shows error message
- [ ] Non-existent user shows error message
- [x] Error message clears when typing (FIXED)

### 1.4 Successful Login
- [x] Valid credentials redirect to Dashboard
- [x] No console errors during login

### 1.5 First-Time Password Change
- [ ] New Cognito user prompted to change password
- [ ] Password requirements shown (12+ chars, mixed case, numbers, symbols)
- [ ] Mismatched passwords show validation error
- [ ] Successful password change redirects to Dashboard

---

## Test 2: Protected Routes

### 2.1 Unauthenticated Access
- [x] Visiting `/` redirects to `/login`
- [ ] Visiting `/create` redirects to `/login`
- [ ] Visiting `/mosaic/123` redirects to `/login`
- [ ] Visiting `/job/123` redirects to `/login`

### 2.2 Post-Login Redirect
- [ ] After login, redirects to originally requested page
- [x] Direct `/login` access redirects to `/` after login

---

## Test 3: Dashboard Page

**URL:** http://localhost:5173/

### 3.1 Page Load
- [x] Dashboard loads without errors (FIXED - was crashing due to API response mismatch)
- [x] "Mosaics" heading displayed
- [x] "Create New" button visible
- [ ] Loading skeletons shown while fetching

### 3.2 Empty State
- [x] When no mosaics exist, empty state message shown
- [x] "Create Mosaic" button in empty state works

### 3.3 Mosaic Grid (when mosaics exist)
- [ ] Mosaic cards displayed in grid
- [ ] Each card shows thumbnail (or placeholder)
- [ ] Each card shows title or ID
- [ ] Status badge displayed (pending/processing/completed/failed)
- [ ] "Main" badge shown on main mosaic
- [ ] Created date displayed

### 3.4 Navigation
- [ ] Clicking mosaic card navigates to `/mosaic/{id}`
- [x] "Create New" button navigates to `/create`

### 3.5 Auto-Refresh
- [ ] Data refreshes automatically (check Network tab, should refresh every 30s)

### 3.6 Layout
- [x] Sidebar shows "Dashboard" and "Create Mosaic" links
- [x] Current page highlighted in sidebar
- [x] User email shown in header
- [x] "Sign out" button visible
- [ ] Mobile: Hamburger menu works

---

## Test 4: Create Mosaic Page

**URL:** http://localhost:5173/create

### 4.1 Page Load
- [x] Page loads without errors
- [x] "Create Mosaic" heading displayed
- [x] All form fields visible

### 4.2 Image Upload
- [ ] Click upload area opens file picker
- [ ] Drag and drop works
- [x] Image preview shown after selection
- [x] File name displayed
- [x] "Remove" button clears selection
- [ ] Only image files accepted

### 4.3 Form Fields
- [x] Title input accepts text
- [x] Tile size dropdown has options: 16, 32, 64
- [x] Mode dropdown has options: 1, 4, 9, 16, 25, 32, Random
- [x] Opacity slider works (0.0 to 1.0)
- [x] Opacity value displayed
- [x] "No repeat tiles" checkbox works
- [x] "Crop tiles" checkbox works

### 4.4 Form Validation
- [x] Submit disabled without image
- [x] Submit enabled after image selection

### 4.5 Submission Flow
- [x] Submit button shows "Creating..."
- [x] Progress messages shown:
  - [x] "Getting upload URL..."
  - [ ] "Uploading image..." (BLOCKED by S3 CORS - needs redeploy)
  - [ ] "Creating mosaic..."
  - [ ] "Starting generation job..."
- [ ] On success, redirects to `/job/{id}`
- [x] On error, error message displayed ("Failed to fetch")

### 4.6 Cancel
- [ ] "Cancel" button returns to Dashboard

---

## Test 5: Mosaic Detail Page

**URL:** http://localhost:5173/mosaic/{id}

_Not tested - no mosaics exist in empty state_

### 5.1 Page Load
- [ ] Page loads without errors
- [ ] Back link to Dashboard works
- [ ] Mosaic title/ID displayed
- [ ] Status badge displayed

### 5.2 Completed Mosaic
- [ ] Full mosaic image displayed
- [ ] "View Full Size" link opens image in new tab
- [ ] "Set as Main" button visible (if not already main)
- [ ] "Regenerate" button visible
- [ ] "Delete" button visible

### 5.3 Processing Mosaic
- [ ] Loading spinner shown
- [ ] "Generating mosaic..." message
- [ ] Auto-refresh active (every 5s)

### 5.4 Failed Mosaic
- [ ] Error state displayed
- [ ] "Regenerate" button works

### 5.5 Details Section
- [ ] Created date shown
- [ ] Tile size shown
- [ ] Mode shown
- [ ] Tint opacity shown
- [ ] No-repeat shown (if enabled)
- [ ] Crop shown (if enabled)

### 5.6 Job History
- [ ] Previous jobs listed
- [ ] Each job shows status, timestamp
- [ ] Failed jobs show error message
- [ ] Clicking job navigates to Job Status page

### 5.7 Actions
- [ ] "Set as Main" updates mosaic, shows success
- [ ] "Regenerate" creates new job, redirects to Job Status
- [ ] "Delete" shows confirmation modal
- [ ] Delete confirmation actually deletes
- [ ] After delete, redirects to Dashboard

---

## Test 6: Job Status Page

**URL:** http://localhost:5173/job/{id}

_Not tested - no jobs exist in empty state_

### 6.1 Page Load
- [ ] Page loads without errors
- [ ] Back link works
- [ ] Job ID displayed

### 6.2 Pending Job
- [ ] Yellow clock icon shown
- [ ] "Pending" status text
- [ ] "Cancel Job" button visible

### 6.3 Running Job
- [ ] Blue spinner icon shown
- [ ] "Running" status text
- [ ] Duration counter updates
- [ ] "Cancel Job" button visible
- [ ] Auto-refresh active (every 3s)

### 6.4 Succeeded Job
- [ ] Green checkmark icon shown
- [ ] "Completed" status text
- [ ] Duration shown
- [ ] "View Mosaic" button visible
- [ ] Button navigates to Mosaic Detail

### 6.5 Failed Job
- [ ] Red X icon shown
- [ ] "Failed" status text
- [ ] Error message displayed
- [ ] "Back to Mosaic" button visible

### 6.6 Cancelled Job
- [ ] Gray icon shown
- [ ] "Cancelled" status text
- [ ] "Back to Mosaic" button visible

### 6.7 Cancel Action
- [ ] "Cancel Job" shows "Cancelling..."
- [ ] Job status updates to cancelled

---

## Test 7: Logout

### 7.1 Sign Out
- [x] "Sign out" button in header works
- [x] Redirects to login page
- [x] Cannot access protected routes after logout
- [ ] Refresh page still shows login

---

## Test 8: Error Handling

### 8.1 Network Errors
- [ ] Offline: Shows error message on API calls
- [ ] API timeout: Shows error message

### 8.2 API Errors
- [ ] 401 Unauthorized: Redirects to login
- [ ] 403 Forbidden: Shows error message
- [ ] 404 Not Found: Shows error message
- [ ] 500 Server Error: Shows error message

### 8.3 Invalid Routes
- [ ] `/mosaic/invalid-id` shows error or redirects
- [ ] `/job/invalid-id` shows error or redirects

---

## Test 9: Responsive Design

_Not tested - browser resize failed, needs manual testing_

### 9.1 Desktop (>1024px)
- [ ] Sidebar always visible
- [ ] Grid shows 4 columns

### 9.2 Tablet (768-1024px)
- [ ] Sidebar collapses to hamburger
- [ ] Grid shows 2-3 columns

### 9.3 Mobile (<768px)
- [ ] Hamburger menu works
- [ ] Sidebar overlay closes on navigation
- [ ] Grid shows 1-2 columns
- [ ] Forms are full-width
- [ ] Touch targets are adequate size

---

## Test 10: Console & Network

### 10.1 No Errors
- [x] No JavaScript errors in console (after fixes applied)
- [ ] No React warnings in console
- [ ] No failed network requests (except expected 404s)

### 10.2 API Calls
- [x] Auth token included in API requests (Authorization header)
- [x] CORS headers present in responses
- [x] Requests go through `/api` proxy

---

## Known Issues

_Issues found and fixed during testing:_

1. **Dashboard crash (FIXED)**
   - Steps to reproduce: Login and navigate to Dashboard
   - Expected: Dashboard loads with mosaic list or empty state
   - Actual: Blank white page, React error in console
   - Error message: `Cannot read properties of undefined (reading 'length')`
   - Root cause: API returns `{ mosaics: [] }` but code expected `{ items: [] }`
   - Fix: Transform API response in `listMosaics()` and `listJobs()` functions

2. **Login error persists (FIXED)**
   - Steps to reproduce: Enter wrong password, see error, start typing
   - Expected: Error message clears when user starts typing
   - Actual: Error message remained visible
   - Fix: Added `clearError()` call to email and password onChange handlers

3. **S3 upload CORS error (FIX PENDING)**
   - Steps to reproduce: Upload image and click "Create Mosaic"
   - Expected: Image uploads to S3
   - Actual: CORS error blocking PUT request to S3
   - Error message: `Access to fetch blocked by CORS policy`
   - Fix: Added PUT method to S3 CORS config in CloudFormation template
   - Status: Requires `ENVIRONMENT=rc ./deploy-cloud.sh` to apply

---

## Test Results

| Test | Pass | Fail | Notes |
|------|------|------|-------|
| 1. Login Page | 9 | 0 | Error clearing fixed |
| 2. Protected Routes | 2 | 0 | Basic tests passed |
| 3. Dashboard Page | 8 | 0 | Fixed API response mismatch |
| 4. Create Mosaic Page | 14 | 1 | S3 CORS blocks upload (fix pending deploy) |
| 5. Mosaic Detail Page | - | - | Not tested (no data) |
| 6. Job Status Page | - | - | Not tested (no data) |
| 7. Logout | 3 | 0 | All tested items pass |
| 8. Error Handling | - | - | Not tested |
| 9. Responsive Design | - | - | Not tested (manual needed) |
| 10. Console & Network | 4 | 0 | No errors after fixes |

**Summary:** 40 tests passed, 1 blocked (S3 CORS), remaining tests need data or manual testing.

---

## Fixes Applied

| File | Change |
|------|--------|
| `admin-ui/src/services/api.ts` | Transform `listMosaics` response: `{ mosaics }` -> `{ items }` |
| `admin-ui/src/services/api.ts` | Transform `listJobs` response: `{ jobs }` -> `{ items }` |
| `admin-ui/src/pages/Login.tsx` | Add `clearError()` on email input change |
| `admin-ui/src/pages/Login.tsx` | Add `clearError()` on password input change |
| `aws-backend/cloudformation/mosaic-infrastructure.yaml` | Add PUT to S3 CORS AllowedMethods |

**Next Step:** Run `ENVIRONMENT=rc ./deploy-cloud.sh` to apply S3 CORS fix, then retest upload flow.
