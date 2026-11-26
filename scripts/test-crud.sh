#!/usr/bin/env bash
# Tes CRUD endpoint /api/tickets lewat Invoke URL API Gateway.
# Pakai: ./scripts/test-crud.sh https://xxxx.execute-api.us-east-1.amazonaws.com
# Simpan bukti: ./scripts/test-crud.sh <URL> | tee evidence/06-curl-crud.txt
set -u

BASE="${1:?Usage: $0 <invoke-url>}"
BASE="${BASE%/}"                                   # buang "/" di akhir URL
H='Content-Type: application/json'
FAKE_ID='00000000-0000-0000-0000-000000000000'     # UUID yang pasti tidak ada
PASS=0; FAIL=0

# step <judul> <status_harapan> <argumen curl...>
# Menjalankan curl, mencetak body + status, dan membandingkan dengan harapan.
step() {
  local title="$1" expected="$2"; shift 2
  echo "== $title (harap $expected)"
  local out code body
  out=$(curl -s -w $'\n%{http_code}' "$@")
  code="${out##*$'\n'}"                            # baris terakhir = status code
  body="${out%$'\n'*}"                             # sisanya = body
  echo "$body [$code]"
  if [ "$code" = "$expected" ]; then echo "   -> PASS"; PASS=$((PASS+1))
  else echo "   -> FAIL"; FAIL=$((FAIL+1)); fi
  LAST_BODY="$body"
}

echo "Base URL: $BASE"
echo "Waktu   : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

step "1. POST valid" 201 -X POST "$BASE/api/tickets" -H "$H" \
  -d '{"buyer_name":"Budi","type":"vip","price":250000}'
ID=$(echo "$LAST_BODY" | jq -r '.id // empty' 2>/dev/null)
if [ -z "$ID" ]; then echo "Tidak dapat id dari POST, berhenti."; exit 1; fi
echo "   id baru: $ID"

step "2. POST nama kosong" 400 -X POST "$BASE/api/tickets" -H "$H" \
  -d '{"buyer_name":"","price":1000}'

step "3. POST type gold" 400 -X POST "$BASE/api/tickets" -H "$H" \
  -d '{"buyer_name":"Ani","type":"gold","price":1000}'

step "4. GET list" 200 "$BASE/api/tickets"

step "5. PUT id yang ada" 200 -X PUT "$BASE/api/tickets/$ID" -H "$H" \
  -d '{"buyer_name":"Budi S","type":"regular","price":150000}'

step "6. PUT id tidak ada" 404 -X PUT "$BASE/api/tickets/$FAKE_ID" -H "$H" \
  -d '{"buyer_name":"X","type":"vip","price":1}'

step "7. DELETE id yang ada" 204 -X DELETE "$BASE/api/tickets/$ID"

step "8. DELETE id yang sama lagi" 404 -X DELETE "$BASE/api/tickets/$ID"

echo
echo "Hasil: $PASS PASS, $FAIL FAIL"
[ "$FAIL" -eq 0 ]
