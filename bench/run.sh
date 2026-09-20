#!/usr/bin/env bash
# Benchmark matrix orchestrator for Boring CMS.
#
# For each (runtime x vCPU) combo:
#   - fresh temp data dir (never touches ./data)
#   - server started under taskset with a memory cap (see README constraints)
#   - bench/bench.mjs driven from an unpinned Node client
#   - server peak RSS recorded, server killed, temp dir removed
#
# Results land in bench/results/v<version>/<runtime>-<n>cpu.json plus a
# generated summary.md. Re-run after a release to get a comparable set.
#
# Usage: bash bench/run.sh [runtimes] [cpulist]
#   bash bench/run.sh                 # node,bun,deno x 1,2,4
#   bash bench/run.sh node 1          # one combo
set -uo pipefail
cd "$(dirname "$0")/.."

NODE_BIN="${NODE_BIN:-$(command -v node || echo "$HOME/.nvm/versions/node/v24.13.1/bin/node")}"
BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
DENO_BIN="${DENO_BIN:-$HOME/.deno/bin/deno}"

RUNTIMES="${1:-node,bun,deno}"
CPUS="${2:-1,2,4}"
VERSION=$("$NODE_BIN" -p "require('./package.json').version")
OUTDIR="bench/results/v$VERSION"
mkdir -p "$OUTDIR"
PORT=4710
SERVER_PID=""
DATA_DIR=""
FAILED=0
BENCH_ARGS="${BENCH_ARGS:-}"

# Toolchain + constraints record: makes each dataset self-describing so runs
# taken on different days stay comparable. Lists every runtime (node, bun,
# deno) plus pnpm with its version, the date, and the fixed constraints.
NODE_V=$("$NODE_BIN" -v 2>/dev/null)
BUN_V=$([ -x "$BUN_BIN" ] && "$BUN_BIN" --version 2>/dev/null || echo "")
DENO_V=$([ -x "$DENO_BIN" ] && "$DENO_BIN" --version 2>/dev/null | head -1 | awk '{print $2}' || echo "")
PNPM_V=$(command -v pnpm >/dev/null 2>&1 && pnpm -v 2>/dev/null || echo "")
HOST=$(uname -srm)
"$NODE_BIN" -e "
  const fs = require('fs');
  fs.writeFileSync('$OUTDIR/toolchain.json', JSON.stringify({
    date: new Date().toISOString(),
    cms_version: '$VERSION',
    host: '$HOST',
    node: '$NODE_V', bun: '$BUN_V', deno: '$DENO_V', pnpm: '$PNPM_V',
    constraints: { heap_mb: 768, rate_limit_per_min: 100000000, cpu_pinning: 'taskset', client_runtime: 'node $NODE_V' },
  }, null, 2) + '\n');
"
echo "toolchain: node=$NODE_V bun=${BUN_V:-n/a} deno=${DENO_V:-n/a} pnpm=${PNPM_V:-n/a} ($(date -u +%Y-%m-%dT%H:%M:%SZ))"

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$DATA_DIR" ] && rm -rf "$DATA_DIR"
}
trap cleanup EXIT

cpu_mask() {
  case "$1" in
    1) echo "0" ;;
    2) echo "0,1" ;;
    4) echo "0-3" ;;
    *) echo "0-$(( $1 - 1 ))" ;;
  esac
}

server_cmd() {
  # Memory cap ~768 MB heap where the runtime supports it (small-VPS analogy).
  case "$1" in
    node) echo "$NODE_BIN --max-old-space-size=768 server.ts" ;;
    bun)  echo "$BUN_BIN --smol server.ts" ;;
    deno) echo "$DENO_BIN run -A --v8-flags=--max-old-space-size=768 server.ts" ;;
  esac
}

runtime_version() {
  case "$1" in
    node) "$NODE_BIN" -v ;;
    bun)  echo "bun $("$BUN_BIN" --version)" ;;
    deno) "$DENO_BIN" --version | head -1 | cut -d'(' -f1 ;;
  esac
}

IFS=',' read -ra RT <<< "$RUNTIMES"
IFS=',' read -ra CP <<< "$CPUS"

for rt in "${RT[@]}"; do
  CMD=$(server_cmd "$rt")
  BIN=$(echo "$CMD" | cut -d' ' -f1)
  if [ ! -x "$BIN" ]; then
    echo "SKIP $rt: $BIN not found"
    continue
  fi
  RTV=$(runtime_version "$rt")
  for ncpu in "${CP[@]}"; do
    LABEL="$rt-${ncpu}cpu"
    OUT="$OUTDIR/$LABEL.json"
    PORT=$((PORT + 1))
    DATA_DIR=$(mktemp -d /tmp/boring-cms-bench-XXXXXX)
    MASTER_KEY=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    echo "=== $LABEL (port $PORT, data $DATA_DIR, $RTV) ==="

    YNCMS_DATA_DIR="$DATA_DIR" MASTER_KEY="$MASTER_KEY" SECRET_KEY="$MASTER_KEY" PORT="$PORT" \
      taskset -c "$(cpu_mask "$ncpu")" $CMD >"$OUTDIR/$LABEL.server.log" 2>&1 &
    SERVER_PID=$!

    # Resource sampler: epoch_ms, cumulative cpu ticks (utime+stime, CLK_TCK
    # 100), rss_kb every ~100ms, for CPU/memory-vs-time graphs per phase.
    USAGE_CSV="$OUTDIR/$LABEL.usage.csv"
    echo "epoch_ms,cpu_ticks,rss_kb" > "$USAGE_CSV"
    (
      while kill -0 "$SERVER_PID" 2>/dev/null; do
        STAT=$(cat "/proc/$SERVER_PID/stat" 2>/dev/null) || break
        TICKS=$(echo "$STAT" | awk '{print $14+$15}')
        RSS=$(grep -s VmRSS "/proc/$SERVER_PID/status" | awk '{print $2}')
        echo "$(date +%s%3N),$TICKS,${RSS:-0}" >> "$USAGE_CSV"
        sleep 0.1
      done
    ) &
    SAMPLER_PID=$!

    # Wait for the server to answer (first-run 302 to /setup).
    up=""
    for _ in $(seq 1 60); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null)
      if [ "$code" = "302" ] || [ "$code" = "200" ]; then up=1; break; fi
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.5
    done

    if [ -z "$up" ]; then
      REASON=$(head -1 "$OUTDIR/$LABEL.server.log" | tr -d '"' | tr -d '\\')
      echo "{\"label\":\"$LABEL\",\"runtime\":\"$RTV\",\"failed\":\"server did not start: ${REASON:-no output}\"}" > "$OUT"
      echo "FAILED to start; log tail:"; tail -5 "$OUTDIR/$LABEL.server.log"
    else
      "$NODE_BIN" bench/bench.mjs --base "http://127.0.0.1:$PORT" --out "$OUT" --label "$LABEL" $BENCH_ARGS \
        || echo "driver failed for $LABEL"
      # Record peak RSS and runtime metadata into the result JSON.
      PEAK_KB=$(grep VmHWM "/proc/$SERVER_PID/status" 2>/dev/null | awk '{print $2}')
      "$NODE_BIN" -e "
        const fs = require('fs');
        const j = JSON.parse(fs.readFileSync('$OUT', 'utf8'));
        j.runtime = '$rt'; j.runtime_version = '$RTV'.trim(); j.vcpus = $ncpu;
        j.server_peak_rss_mb = ${PEAK_KB:-0} ? Math.round(${PEAK_KB:-0} / 1024) : null;
        j.cms_version = '$VERSION';
        fs.writeFileSync('$OUT', JSON.stringify(j, null, 2) + '\n');
      "
    fi

    kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null
    kill "$SAMPLER_PID" 2>/dev/null; wait "$SAMPLER_PID" 2>/dev/null
    SERVER_PID=""
    rm -rf "$DATA_DIR"; DATA_DIR=""
  done
done

# summarize.mjs exits nonzero if any combo failed or a phase errored past
# threshold; propagate that so a broken bench run fails loud (CI, callers).
"$NODE_BIN" bench/summarize.mjs "$OUTDIR" > "$OUTDIR/summary.md" || FAILED=1
echo "summary: $OUTDIR/summary.md"
[ "$FAILED" = 0 ] || { echo "bench had failures; see $OUTDIR/summary.md"; exit 1; }
