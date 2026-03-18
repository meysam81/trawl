# Pack the extension into a signed .crx using crx3 (go install github.com/mediabuyerbot/go-crx3/crx3@latest).
# Requires chrome-webstore-privatekey.pem. Generate one with: crx3 keygen chrome-webstore-privatekey.pem
pack: build
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ ! -f chrome-webstore-privatekey.pem ]]; then
        echo "ERROR: chrome-webstore-privatekey.pem not found."
        echo "Generate one with: crx3 keygen chrome-webstore-privatekey.pem"
        exit 1
    fi
    crx3 pack dist -p chrome-webstore-privatekey.pem -o trawl.crx
    ls -lh trawl.crx
    echo "$PWD/trawl.crx"

dist:
    cd dist && zip ../dist.zip -r . && echo $PWD/dist.zip

build:
    bun run build

# Print CWS extension public key from local PEM
cws-pubkey:
    openssl rsa -in chrome-webstore-privatekey.pem -pubout -outform PEM 2>/dev/null
    @echo
