#!/usr/bin/env bash
# 备份沙漠掘金沙盘数据库（Docker 部署方式）
# 用法：bash scripts/backup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="${CONTAINER:-desert-gold}"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="desert-gold-${STAMP}.db"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "${ROOT}/backups"

# 用 better-sqlite3 的 online backup，避免直接拷贝正在写入的库
docker exec "${CONTAINER}" node -e "
const { db } = require('/app/src/db');
db.backup('/data/backup-${STAMP}.db')
  .then(() => console.log('backup ok'))
  .catch((e) => { console.error(e); process.exit(1); });
"

docker cp "${CONTAINER}:/data/backup-${STAMP}.db" "${ROOT}/backups/${NAME}"
docker exec "${CONTAINER}" rm -f "/data/backup-${STAMP}.db"

find "${ROOT}/backups" -name '*.db' -mtime +"${KEEP_DAYS}" -delete || true
echo "已备份：${ROOT}/backups/${NAME}"
