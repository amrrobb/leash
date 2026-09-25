#!/usr/bin/env bash
# Full Leash deploy: DeployLeash (registry, roles, Aqua, tokens, Vault) then MandateAquaRouter.
# usage: RPC=<url> ALICE_KEY=0x.. AGENT=0x.. BACKEND=0x.. OUT=<json> [SPEED=1440] [SALT=..] script/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${RPC:?}" "${ALICE_KEY:?}" "${AGENT:?}" "${BACKEND:?}" "${OUT:?}"

forge script script/DeployLeash.s.sol --rpc-url "$RPC" --broadcast --slow >/dev/null

AQUA=$(jq -r .aqua "$OUT")
ALICE=$(cast wallet address "$ALICE_KEY")
ROUTER=$(forge create src/MandateAquaRouter.sol:MandateAquaRouter --rpc-url "$RPC" --private-key "$ALICE_KEY" --broadcast \
  --constructor-args "$AQUA" 0x0000000000000000000000000000000000000000 "$ALICE" Leash 1 | awk '/Deployed to:/ {print $3}')
[ -n "$ROUTER" ] || { echo "router deploy failed" >&2; exit 1; }

jq --arg r "$ROUTER" '.router = $r' "$OUT" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
echo "deployed: $(jq -c '{vault, router, userRegistry}' "$OUT")"
