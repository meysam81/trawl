#!/usr/bin/env bash
set -euo pipefail

# Publish a Chrome extension to the Chrome Web Store.
# Required env vars:
#   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
#   CHROME_EXTENSION_ID
#   PUBLISH  — set to "true" to actually publish after upload

: "${GOOGLE_CLIENT_ID:?Missing GOOGLE_CLIENT_ID}"
: "${GOOGLE_CLIENT_SECRET:?Missing GOOGLE_CLIENT_SECRET}"
: "${GOOGLE_REFRESH_TOKEN:?Missing GOOGLE_REFRESH_TOKEN}"
: "${CHROME_EXTENSION_ID:?Missing CHROME_EXTENSION_ID}"

ZIP_FILE="${1:-dist.crx}"

if [[ ! -f "$ZIP_FILE" ]]; then
  # Fallback: zip the dist directory
  ZIP_FILE="dist.zip"
  (cd dist && zip -r "../$ZIP_FILE" .)
fi

echo "--- Obtaining access token ---"
ACCESS_TOKEN=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
  -d "client_id=$GOOGLE_CLIENT_ID" \
  -d "client_secret=$GOOGLE_CLIENT_SECRET" \
  -d "refresh_token=$GOOGLE_REFRESH_TOKEN" \
  -d "grant_type=refresh_token" | jq -r '.access_token')

if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
  echo "ERROR: Failed to obtain access token"
  exit 1
fi

echo "--- Uploading extension ---"
UPLOAD_RESPONSE=$(curl -s \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-goog-api-version: 2" \
  -X PUT \
  -T "$ZIP_FILE" \
  "https://www.googleapis.com/upload/chromewebstore/v1.1/items/$CHROME_EXTENSION_ID")

UPLOAD_STATUS=$(echo "$UPLOAD_RESPONSE" | jq -r '.uploadState')
echo "Upload status: $UPLOAD_STATUS"

if [[ "$UPLOAD_STATUS" != "SUCCESS" ]]; then
  echo "ERROR: Upload failed"
  echo "$UPLOAD_RESPONSE" | jq .
  exit 1
fi

if [[ "${PUBLISH:-false}" == "true" ]]; then
  echo "--- Publishing extension ---"
  PUBLISH_RESPONSE=$(curl -s \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-goog-api-version: 2" \
    -H "Content-Length: 0" \
    -X POST \
    "https://www.googleapis.com/chromewebstore/v1.1/items/$CHROME_EXTENSION_ID/publish")

  PUBLISH_STATUS=$(echo "$PUBLISH_RESPONSE" | jq -r '.status[0]')
  echo "Publish status: $PUBLISH_STATUS"

  if [[ "$PUBLISH_STATUS" != "OK" ]]; then
    echo "WARNING: Publish may have issues"
    echo "$PUBLISH_RESPONSE" | jq .
  fi
fi

echo "--- Done ---"
