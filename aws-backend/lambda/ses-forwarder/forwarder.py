"""
SES Receiving Forwarder.

Triggered by an SES Receipt Rule. Reads the incoming raw email from S3,
rewrites headers per RFC for forwarding (preserves the original From in
Reply-To, sets the actual From to FROM_ADDRESS so SES will sign+send it),
and re-sends via ses:SendRawEmail to FORWARD_TO.

Why the header rewrite: SES outbound rejects mails whose From: domain
isn't verified in the sending region. The original sender (e.g.
some-random@gmail.com) isn't verified, so we forward as
"<original-from> via privacidad <noreply@casadelmanco.com>" with
Reply-To set to the original sender so replies go back to them.
"""

import email
import os
import boto3
from botocore.exceptions import ClientError


s3 = boto3.client('s3')
ses = boto3.client('ses')

FORWARD_TO = os.environ['FORWARD_TO']
MAIL_BUCKET = os.environ['MAIL_BUCKET']
FROM_ADDRESS = os.environ.get('FROM_ADDRESS', 'noreply@casadelmanco.com')


def lambda_handler(event, context):
    for record in event['Records']:
        message_id = record['ses']['mail']['messageId']
        print(f"Forwarding message {message_id}")

        obj = s3.get_object(Bucket=MAIL_BUCKET, Key=message_id)
        raw = obj['Body'].read()

        msg = email.message_from_bytes(raw)

        original_from = msg.get('From', '')
        original_subject = msg.get('Subject', '(no subject)')

        # Strip headers that would conflict with re-signing / re-sending.
        for header in ('DKIM-Signature', 'Return-Path', 'Sender', 'Message-ID'):
            if header in msg:
                del msg[header]

        if 'Reply-To' not in msg and original_from:
            msg['Reply-To'] = original_from

        # Replace From so SES will accept the outbound send. Preserve the
        # original sender name in the display string for readability.
        del msg['From']
        if original_from:
            display = original_from.replace('"', '').strip()
            msg['From'] = f'"{display} (via privacidad)" <{FROM_ADDRESS}>'
        else:
            msg['From'] = FROM_ADDRESS

        del msg['To']
        msg['To'] = FORWARD_TO

        try:
            response = ses.send_raw_email(
                Source=FROM_ADDRESS,
                Destinations=[FORWARD_TO],
                RawMessage={'Data': msg.as_bytes()},
            )
            print(f"Forwarded {message_id} -> {FORWARD_TO} as {response['MessageId']} (subject: {original_subject})")
        except ClientError as e:
            print(f"send_raw_email failed for {message_id}: {e}")
            raise

    return {'status': 'ok'}
