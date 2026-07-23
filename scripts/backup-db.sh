#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="${project_dir}/backups"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_dir}/epay_gateway_${timestamp}.sql.gz"

mkdir -p "${backup_dir}"
cd "${project_dir}"
docker compose exec -T db sh -c 'mariadb-dump --single-transaction --quick -u root -p"$MARIADB_ROOT_PASSWORD" epay_gateway' | gzip -9 > "${backup_file}"
chmod 600 "${backup_file}"
echo "数据库备份已生成：${backup_file}"
