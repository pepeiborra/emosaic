#!/bin/bash
# Helper script to find VPC information for Batch deployment

echo "🔍 Finding VPC information for AWS Batch..."
echo ""

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Please run 'aws configure' first."
    exit 1
fi

REGION=${AWS_REGION:-us-east-1}
echo "Region: $REGION"
echo ""

# List all VPCs
echo "Available VPCs:"
aws ec2 describe-vpcs --region $REGION --query 'Vpcs[*].[VpcId,CidrBlock,Tags[?Key==`Name`].Value|[0]]' --output table

echo ""
echo "To see subnets for a specific VPC, run:"
echo "  aws ec2 describe-subnets --filters \"Name=vpc-id,Values=vpc-XXXXX\" --query 'Subnets[*].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch]' --output table"
echo ""
echo "For Batch, you need:"
echo "  - Private subnets (MapPublicIpOnLaunch=False) OR"
echo "  - Public subnets with NAT Gateway configured"
echo "  - At least 2 subnets in different availability zones"
echo ""
echo "Example deployment command:"
echo "  VPC_ID=vpc-xxx SUBNET_IDS=subnet-aaa,subnet-bbb ADMIN_EMAIL=your@email.com ./aws-backend/deploy-cloud.sh"
