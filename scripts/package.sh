#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
archive_path="${project_dir}/newapi-epay-gateway.zip"

command -v zip >/dev/null 2>&1 || {
  echo "缺少 zip，请先执行：sudo apt install -y zip" >&2
  exit 1
}
command -v git >/dev/null 2>&1 || {
  echo "缺少 git，无法按忽略规则安全打包" >&2
  exit 1
}

cd "${project_dir}"
rm -f "${archive_path}"
git ls-files -co --exclude-standard | zip -q "${archive_path}" -@

echo "已生成：${archive_path}"
if zipinfo -1 "${archive_path}" | grep -E '(^|/)\.env$|(^|/)secrets/[^.].*|\.pem$|\.crt$' >/dev/null; then
  echo "安全检查失败：压缩包中疑似包含密钥、证书或 .env" >&2
  rm -f "${archive_path}"
  exit 1
fi
