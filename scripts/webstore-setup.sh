#!/usr/bin/env bash
# One-time Google Cloud setup for publishing Crunchy+ to the Chrome Web Store from CI (docs/release.md). Idempotent.
# Shares the project and publisher service account with RSI+ (same Web Store developer account); only the federation
# provider for this repo is its own.
# Web Store API v2 authenticates as a Google Cloud *service account* that the developer dashboard trusts, so this makes:
#   - project PROJECT with the Chrome Web Store, IAM, IAM Credentials and STS APIs
#   - service account webstore-publisher
#   - Workload Identity Federation pool "github" + OIDC provider for this repo, bound to the service account
#     (GitHub Actions trades its OIDC token for a short-lived Google access token: no key file anywhere)
#   - impersonation rights for the logged-in user (local `wxt submit --dry-run`)
# and prints the service account email to add in the dashboard, plus the GitHub variables to set.
#
#   bash scripts/webstore-setup.sh [PROJECT_ID] [OWNER/REPO]
set -euo pipefail
PROJECT="${1:-rsi-plus-publish}"
REPO="${2:-NyleGarcia/crunchy-plus}"
SA_NAME=webstore-publisher
PROVIDER="${REPO##*/}" # one federation provider per repo, named after it
GCLOUD="${GCLOUD:-$(command -v gcloud || echo "$HOME/google-cloud-sdk/bin/gcloud")}"

acct=$("$GCLOUD" config get-value account 2>/dev/null || true)
[ -n "$acct" ] || { echo "gcloud is not logged in — run: $GCLOUD auth login" >&2; exit 1; }
echo "account: $acct"

if ! "$GCLOUD" projects describe "$PROJECT" >/dev/null 2>&1; then
  echo "creating project $PROJECT"
  err=$(mktemp)
  if ! "$GCLOUD" projects create "$PROJECT" --name="RSI Plus Web Store publishing" 2>"$err"; then
    if grep -q "type: TOS" "$err"; then
      echo "This Google account has not accepted the Google Cloud terms yet. Open https://console.cloud.google.com/ once as $acct, accept, then rerun." >&2
    else
      cat "$err" >&2
    fi
    rm -f "$err"; exit 1
  fi
  rm -f "$err"
fi
"$GCLOUD" config set project "$PROJECT" >/dev/null
"$GCLOUD" services enable chromewebstore.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project "$PROJECT"
NUM=$("$GCLOUD" projects describe "$PROJECT" --format='value(projectNumber)')
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"

"$GCLOUD" iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 \
  || "$GCLOUD" iam service-accounts create "$SA_NAME" --display-name="Chrome Web Store publisher (GitHub Actions)" --project "$PROJECT"
"$GCLOUD" iam workload-identity-pools describe github --location=global --project "$PROJECT" >/dev/null 2>&1 \
  || "$GCLOUD" iam workload-identity-pools create github --location=global --display-name="GitHub Actions" --project "$PROJECT"
"$GCLOUD" iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool=github --location=global --project "$PROJECT" >/dev/null 2>&1 \
  || "$GCLOUD" iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool=github --location=global --project "$PROJECT" \
       --display-name="$PROVIDER repo" --issuer-uri="https://token.actions.githubusercontent.com" \
       --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
       --attribute-condition="assertion.repository == '$REPO'"
"$GCLOUD" iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" --quiet >/dev/null
"$GCLOUD" iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT" --role=roles/iam.serviceAccountTokenCreator --member="user:$acct" --quiet >/dev/null
PROVIDER=$("$GCLOUD" iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool=github --location=global --project "$PROJECT" --format='value(name)')

cat <<MSG

Done. Now:
 1. Chrome Web Store developer dashboard → Account → "Service accounts" (API v2 access): add
      $SA
    (the dashboard must list it before the API answers for this publisher).
 2. GitHub variables (not secrets; already set for this repo if you ran this before):
      gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body "$PROVIDER"
      gh variable set GCP_SERVICE_ACCOUNT --body "$SA"
    and the chrome-web-store environment secrets CHROME_EXTENSION_ID / CHROME_PUBLISHER_ID.
 3. Local check (impersonates the service account with the chromewebstore scope; nothing stored):
      bash scripts/webstore-token.sh   # prints nothing; exports CHROME_SERVICE_ACCOUNT_ACCESS_TOKEN when sourced
      source scripts/webstore-token.sh && npx wxt submit --dry-run --chrome-api-version v2 --chrome-zip .output/crunchy-plus-*-chrome.zip
MSG
