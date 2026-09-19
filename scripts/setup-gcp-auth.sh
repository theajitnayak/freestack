#!/usr/bin/env bash
#
# One-time setup so the weekly terms check can call Vertex AI from GitHub Actions.
#
# Run this once, after `gcloud auth login`. It is idempotent — running it again
# is safe and will just report that everything already exists.
#
#   bash scripts/setup-gcp-auth.sh
#
# What it sets up, and why it looks like this:
#
# Workload Identity Federation, not a service account key. A key is a long-lived
# secret that would sit in this repo's settings until someone rotated it, which
# nobody ever does. WIF instead lets a workflow run prove who it is with a
# short-lived OIDC token, so there is no credential to leak or rotate. The
# attribute condition below is what makes that safe: without it, ANY repository
# on GitHub could ask for a token against this pool.
#
set -euo pipefail

# The project linked to the billing account holding the free trial credit.
# Confirmed with `gcloud billing projects describe`; the other three projects on
# this account have billing disabled. Note the id ends -ab6, not -a6b6.
PROJECT="${GCP_PROJECT:-project-432db1bb-a8a3-4cf6-ab6}"
REPO="${GH_REPO:-theajitnayak/freestack}"
SA_NAME="terms-check"
POOL="github"
PROVIDER="freestack"
LOCATION="global"

# The SDK installs outside PATH on Windows often enough to be worth handling.
GCLOUD="$(command -v gcloud || true)"
for p in \
  "$HOME/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd" \
  "/c/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd" \
  "/c/Program Files/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"; do
  [ -n "$GCLOUD" ] && break
  [ -f "$p" ] && GCLOUD="$p"
done
[ -n "$GCLOUD" ] || { echo "gcloud not found. Install the Google Cloud SDK first."; exit 1; }

# The SDK's default Windows location contains a space ("Cloud SDK"), and
# gcloud.cmd is a batch file: invoked from Git Bash inside an `if` with
# redirections, cmd.exe re-splits the path and dies on the space. Swapping in
# the 8.3 short name sidesteps it entirely. Harmless everywhere else.
case "$GCLOUD" in
  *" "*)
    WIN_PATH="$(cygpath -w "$GCLOUD" 2>/dev/null || echo "$GCLOUD")"
    SHORT="$(powershell -NoProfile -Command \
      "(New-Object -ComObject Scripting.FileSystemObject).GetFile('${WIN_PATH}').ShortPath" 2>/dev/null | tr -d '\r')"
    [ -n "$SHORT" ] && GCLOUD="$(cygpath -u "$SHORT" 2>/dev/null || echo "$SHORT")"
    ;;
esac

GH="$(command -v gh || true)"
[ -n "$GH" ] || [ ! -f "/c/Program Files/GitHub CLI/gh.exe" ] || GH="/c/Program Files/GitHub CLI/gh.exe"

# stderr is swallowed on purpose: with zero accounts gcloud prints a filter
# warning that reads like a failure and sends people debugging the wrong thing.
if ! "$GCLOUD" auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q .; then
  echo "No active gcloud account. Run this first, then re-run this script:"
  echo
  echo "    gcloud auth login"
  echo
  exit 1
fi

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

say "Project: $PROJECT   Repo: $REPO"
"$GCLOUD" config set project "$PROJECT" --quiet

say "Enabling APIs (first run takes a minute)"
# sts + iamcredentials are what actually exchange the GitHub OIDC token.
"$GCLOUD" services enable \
  aiplatform.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --quiet

PROJECT_NUMBER="$("$GCLOUD" projects describe "$PROJECT" --format='value(projectNumber)')"
echo "Project number: $PROJECT_NUMBER"

say "Service account"
if "$GCLOUD" iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  echo "already exists: $SA_EMAIL"
else
  "$GCLOUD" iam service-accounts create "$SA_NAME" \
    --display-name="startupcredits terms check" \
    --description="Reads programme pages via Vertex AI for the weekly terms drift check" \
    --quiet
  echo "created: $SA_EMAIL"
fi

say "Granting Vertex AI access"
# aiplatform.user is enough to call generateContent and nothing else.
"$GCLOUD" projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/aiplatform.user" \
  --condition=None --quiet >/dev/null
echo "roles/aiplatform.user granted"

say "Workload identity pool"
if "$GCLOUD" iam workload-identity-pools describe "$POOL" --location="$LOCATION" >/dev/null 2>&1; then
  echo "already exists: $POOL"
else
  "$GCLOUD" iam workload-identity-pools create "$POOL" \
    --location="$LOCATION" --display-name="GitHub Actions" --quiet
  echo "created: $POOL"
fi

say "OIDC provider, locked to $REPO"
if "$GCLOUD" iam workload-identity-pools providers describe "$PROVIDER" \
     --location="$LOCATION" --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  echo "already exists: $PROVIDER"
else
  # attribute-condition is the security boundary. Without it any repo on GitHub
  # could mint a token against this pool. Google now refuses to create a github
  # provider without one, which is the right call.
  "$GCLOUD" iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location="$LOCATION" \
    --workload-identity-pool="$POOL" \
    --display-name="freestack repo" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository=='${REPO}'" \
    --quiet
  echo "created: $PROVIDER"
fi

say "Letting $REPO impersonate the service account"
"$GCLOUD" iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/${LOCATION}/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" \
  --quiet >/dev/null
echo "bound"

PROVIDER_PATH="projects/${PROJECT_NUMBER}/locations/${LOCATION}/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

say "GitHub secrets"
if [ -n "$GH" ] && "$GH" auth status >/dev/null 2>&1; then
  "$GH" secret set GCP_PROJECT_ID      --repo "$REPO" --body "$PROJECT"
  "$GH" secret set GCP_SERVICE_ACCOUNT --repo "$REPO" --body "$SA_EMAIL"
  "$GH" secret set GCP_WIF_PROVIDER    --repo "$REPO" --body "$PROVIDER_PATH"
  echo "set on $REPO"
else
  echo "gh not authenticated — set these three by hand at"
  echo "https://github.com/${REPO}/settings/secrets/actions"
  echo
  echo "  GCP_PROJECT_ID       $PROJECT"
  echo "  GCP_SERVICE_ACCOUNT  $SA_EMAIL"
  echo "  GCP_WIF_PROVIDER     $PROVIDER_PATH"
fi

say "Done"
cat <<EOF
Try one programme locally before letting the workflow loose on all 80:

  export GOOGLE_CLOUD_PROJECT=$PROJECT
  export GOOGLE_ACCESS_TOKEN=\$(gcloud auth print-access-token)
  ONLY=cloudflare-startups node scripts/check-terms.mjs

Then the same thing in CI:

  gh workflow run "Weekly terms check" --repo $REPO -f only=cloudflare-startups
EOF
