#!/usr/bin/env bash
# Short-lived Chrome Web Store access token for the publisher service account, minted through your own gcloud login
# (IAM Credentials generateAccessToken with the chromewebstore scope — `gcloud auth print-access-token
# --impersonate-service-account` ignores --scopes). Source it: the token lands in CHROME_SERVICE_ACCOUNT_ACCESS_TOKEN,
# which `wxt submit --chrome-api-version v2` reads; it is never printed. docs/release.md.
#
#   source scripts/webstore-token.sh && npx wxt submit --dry-run --chrome-api-version v2 --chrome-zip .output/crunchy-plus-*-chrome.zip
SA="${GCP_SERVICE_ACCOUNT:-webstore-publisher@rsi-plus-publish.iam.gserviceaccount.com}"
GCLOUD="${GCLOUD:-$(command -v gcloud || echo "$HOME/google-cloud-sdk/bin/gcloud")}"
CHROME_SERVICE_ACCOUNT_ACCESS_TOKEN=$(curl -sf -X POST "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SA}:generateAccessToken" \
  -H "Authorization: Bearer $("$GCLOUD" auth print-access-token)" -H "Content-Type: application/json" \
  -d '{"scope":["https://www.googleapis.com/auth/chromewebstore"]}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])') \
  && export CHROME_SERVICE_ACCOUNT_ACCESS_TOKEN && echo "token for $SA ready (1 h)" \
  || echo "could not mint a token for $SA — gcloud logged in, and roles/iam.serviceAccountTokenCreator on it? (scripts/webstore-setup.sh)" >&2
