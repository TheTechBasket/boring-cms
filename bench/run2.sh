#!/usr/bin/env bash
# Benchmark v2 orchestrator. Same constraints as bench/run.sh (taskset pinning,
# 768MB heap, fresh temp data dir, TRUST_PROXY=1), but:
#   - drives bench/bench2.mjs (auto field-type coverage) from THIS checkout
#   - can start the server from any other checkout (--src), so one driver
#     produces a comparable history across versions via git worktrees
#   - results land in bench/results-v2/<version>/
#
# Usage: bash bench/run2.sh [runtimes] [cpulist] [--src DIR] [--version LABEL]
#   bash bench/run2.sh                       # node x 2 on this checkout
#   bash bench/run2.sh node,bun 1,2          # matrix on this checkout
#   bash bench/run2.sh node 2 --src /path/to/worktree --version v0.20.0
set -uo pipefail
cd "$(dirname "$0")/.."

NODE_BIN="${NODE_BIN:-$([ -x "$HOME/.nvm/versions/node/v24.13.1/bin/node" ] && echo "$HOME/.nvm/versions/node/v24.13.1/bin/node" || command -v node)}"
BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
DENO_BIN="${DENO_BIN:-$HOME/.deno/bin/deno}"

RUNTIMES="node"; CPUS="2"; SRC="$PWD"; VLABEL=""
POS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --src) SRC=$(cd "$2" && pwd); shift 2 ;;
    --version) VLABEL="$2"; shift 2 ;;
    *) POS=$((POS + 1)); [ $POS = 1 ] && RUNTIMES="$1" || CPUS="$1"; shift ;;
  esac
done
[ -n "$VLABEL" ] || VLABEL="v$("$NODE_BIN" -p "require('$SRC/package.json').version")"

OUTDIR="bench/results-v2/$VLABEL"
mkdir -p "$OUTDIR"
PORT=4750
SERVER_PID=""
DATA_DIR=""
FAILED=0

NODE_V=$("$NODE_BIN" -v 2>/dev/null)
"$NODE_BIN" -e "
  require('fs').writeFileSync('$OUTDIR/toolchain.json', JSON.stringify({
    date: new Date().toISOString(),
    cms_version: '$VLABEL',
    src: '$SRC',
    host: '$(uname -srm)',
    node: '$NODE_V',
    bun: '$([ -x "$BUN_BIN" ] && "$BUN_BIN" --version 2>/dev/null)',
    deno: '$([ -x "$DENO_BIN" ] && "$DENO_BIN" --version 2>/dev/null | head -1 | awk '{print $2}')',
    constraints: { heap_mb: 768, rate_limit_per_min: 100000000, cpu_pinning: 'taskset', client_runtime: 'node $NODE_V', driver: 'bench2' },
  }, null, 2) + '\n');
"

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$DATA_DIR" ] && rm -rf "$DATA_DIR"
}
trap cleanup EXIT

cpu_mask() { case "$1" in 1) echo 0 ;; 2) echo 0,1 ;; 4) echo 0-3 ;; *) echo "0-$(($1 - 1))" ;; esac; }
server_cmd() {
  case "$1" in
    node) echo "$NODE_BIN --max-old-space-size=768 server.ts" ;;
    bun)  echo "$BUN_BIN --smol server.ts" ;;
    deno) echo "$DENO_BIN run -A --v8-flags=--max-old-space-size=768 server.ts" ;;
  esac
}

IFS=',' read -ra RT <<< "$RUNTIMES"
IFS=',' read -ra CP <<< "$CPUS"

for rt in "${RT[@]}"; do
  CMD=$(server_cmd "$rt")
  BIN=${CMD%% *}
  [ -x "$BIN" ] || { echo "SKIP $rt: $BIN not found"; continue; }
  for ncpu in "${CP[@]}"; do
    LABEL="$rt-${ncpu}cpu"
    OUT="$PWD/$OUTDIR/$LABEL.json"
    PORT=$((PORT + 1))
    DATA_DIR=$(mktemp -d /tmp/boring-cms-bench2-XXXXXX)
    MASTER_KEY=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    echo "=== $VLABEL $LABEL (port $PORT, server src $SRC) ==="

    ( cd "$SRC" && exec env YNCMS_DATA_DIR="$DATA_DIR" MASTER_KEY="$MASTER_KEY" SECRET_KEY="$MASTER_KEY" \
        PORT="$PORT" TRUST_PROXY=1 MALLOC_MMAP_THRESHOLD_=1048576 \
        taskset -c "$(cpu_mask "$ncpu")" $CMD >"$OUT.server.log" 2>&1 ) &
    SERVER_PID=$!

    up=""
    for _ in $(seq 1 60); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null)
      if [ "$code" = "302" ] || [ "$code" = "200" ]; then up=1; break; fi
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.5
    done

    if [ -z "$up" ]; then
      echo "{\"label\":\"$LABEL\",\"failed\":\"server did not start\"}" > "$OUT"
      echo "FAILED to start; log tail:"; tail -5 "$OUT.server.log"
    else
      "$NODE_BIN" bench/bench2.mjs --base "http://127.0.0.1:$PORT" --out "$OUT" --label "$LABEL" \
        || { echo "driver failed for $LABEL"; FAILED=1; }
      PEAK_KB=$(grep VmHWM "/proc/$SERVER_PID/status" 2>/dev/null | awk '{print $2}')
      "$NODE_BIN" -e "
        const fs = require('fs');
        const j = JSON.parse(fs.readFileSync('$OUT', 'utf8'));
        j.runtime = '$rt'; j.vcpus = $ncpu; j.cms_version = '$VLABEL'.replace(/^v/, '');
        j.server_peak_rss_mb = ${PEAK_KB:-0} ? Math.round(${PEAK_KB:-0} / 1024) : null;
        fs.writeFileSync('$OUT', JSON.stringify(j, null, 2) + '\n');
      " 2>/dev/null
    fi

    kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null
    SERVER_PID=""
    rm -rf "$DATA_DIR"; DATA_DIR=""
  done
done

"$NODE_BIN" bench/summarize.mjs "$OUTDIR" > "$OUTDIR/summary.md" || FAILED=1
echo "summary: $OUTDIR/summary.md"
[ "$FAILED" = 0 ] || { echo "bench2 had failures; see $OUTDIR"; exit 1; }
