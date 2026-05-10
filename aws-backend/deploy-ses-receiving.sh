#!/bin/bash
#
# Deploy the SES receiving + forwarder stack (eu-west-1, since SES inbound
# is not in eu-west-3). Run after DNS records for SES verification, DKIM,
# and MX have been added to Route53.
#
# Required env vars:
#   FORWARD_TO          - real mailbox to receive forwarded mail (e.g. you@gmail.com)
#
# Optional env vars:
#   ENVIRONMENT         - default: prod
#   RECIPIENTS          - comma list; default: privacidad@casadelmanco.com
#   FROM_ADDRESS        - default: noreply@casadelmanco.com

set -e

ENVIRONMENT="${ENVIRONMENT:-prod}"
REGION="eu-west-1"
RECIPIENTS="${RECIPIENTS:-privacidad@casadelmanco.com}"
FROM_ADDRESS="${FROM_ADDRESS:-noreply@casadelmanco.com}"
STACK_NAME="${ENVIRONMENT}-ses-receiving"

if [ -z "$FORWARD_TO" ]; then
    echo "❌ Set FORWARD_TO=<your real email> before running."
    exit 1
fi

cd "$(dirname "$0")"

echo "🏗️  Deploying $STACK_NAME in $REGION..."
AWS_PROFILE=admin aws cloudformation deploy \
    --template-file cloudformation/ses-receiving.yaml \
    --stack-name "$STACK_NAME" \
    --parameter-overrides \
        Environment="$ENVIRONMENT" \
        Recipients="$RECIPIENTS" \
        ForwardTo="$FORWARD_TO" \
        FromAddress="$FROM_ADDRESS" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "$REGION"

echo "📤 Updating forwarder Lambda code..."
cd lambda/ses-forwarder
zip -q -r ../../ses_forwarder.zip forwarder.py
cd ../..

FN=$(AWS_PROFILE=admin aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ForwarderFunctionName'].OutputValue" \
    --output text --region "$REGION")
AWS_PROFILE=admin aws lambda update-function-code \
    --function-name "$FN" \
    --zip-file fileb://ses_forwarder.zip \
    --region "$REGION" > /dev/null
rm -f ses_forwarder.zip
echo "✅ Forwarder Lambda code updated"

echo "🟢 Activating receipt rule set..."
RULE_SET=$(AWS_PROFILE=admin aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='RuleSetName'].OutputValue" \
    --output text --region "$REGION")
AWS_PROFILE=admin aws ses set-active-receipt-rule-set \
    --rule-set-name "$RULE_SET" \
    --region "$REGION"

echo ""
echo "✅ SES receiving deployed."
echo "   Send a test mail to $RECIPIENTS — it should land in $FORWARD_TO within a few seconds."
echo "   Logs: AWS_PROFILE=admin aws logs tail /aws/lambda/$FN --region $REGION --follow"
