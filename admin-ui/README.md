# Emosaic Admin UI

React admin interface for managing photo mosaics. For the cross-component picture see [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## Prerequisites

- Node.js 18+
- Backend deployed (see `../aws-backend/deploy-cloud.sh`)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Generate environment configuration:**
   ```bash
   # For rc environment
   ./generate-env.sh rc eu-west-3

   # For prod environment
   ./generate-env.sh prod eu-west-3
   ```

   Or copy `.env.example` to `.env` and fill in values manually.

3. **Start development server:**
   ```bash
   npm run dev
   ```

   The app will be available at http://localhost:5173

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_USER_POOL_ID` | Cognito User Pool ID |
| `VITE_USER_POOL_CLIENT_ID` | Cognito App Client ID |
| `VITE_AWS_REGION` | AWS region (e.g., `eu-west-3`) |
| `VITE_API_URL` | API Gateway URL |

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint
- `./generate-env.sh` - Generate `.env` from CloudFormation outputs
- `./deploy.sh` - Build and deploy to S3/CloudFront

## Deployment

```bash
# Deploy to AWS (builds automatically)
./deploy.sh
```

This will:
1. Fetch Cognito/API config from CloudFormation
2. Build the production bundle
3. Deploy S3 bucket infrastructure (if needed)
4. Upload files to S3
5. Invalidate CloudFront cache

## Tech Stack

- React 19 + TypeScript
- Vite 7
- Tailwind CSS v4
- AWS Amplify v6 (Cognito auth)
- TanStack Query v5 (data fetching)
- React Router v7
