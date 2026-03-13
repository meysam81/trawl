# Pack the extension into a .crx for Chrome Web Store submission.
# First run (no key): generates dist.crx + dist.pem
# Subsequent runs (key exists): reuses dist.pem to produce a consistent .crx
pack: build
    #!/usr/bin/env bash
    set -euo pipefail
    key_flag=""
    if [[ -f chrome-webstore-privatekey.pem ]]; then
        key_flag="--pack-extension-key=$PWD/chrome-webstore-privatekey.pem"
    fi
    google-chrome --no-sandbox --pack-extension="$PWD/dist" $key_flag
    # Chrome outputs dist.crx and (on first run) dist.pem next to the dist/ dir
    if [[ -f dist.pem && ! -f chrome-webstore-privatekey.pem ]]; then
        mv dist.pem chrome-webstore-privatekey.pem
        echo "Generated chrome-webstore-privatekey.pem — keep this safe and secret."
    fi
    echo $PWD/dist.crx

dist:
    cd dist && zip ../dist.zip -r . && echo $PWD/dist.zip

build:
    bun run build

# Print CWS extension public key from local PEM
cws-pubkey:
    openssl rsa -in chrome-webstore-privatekey.pem -pubout -outform PEM 2>/dev/null
    @echo
