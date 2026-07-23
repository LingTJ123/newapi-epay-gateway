# 升级与回滚

## 从旧简化版升级

```bash
sudo cp -a /opt/newapi-alipay-gateway \
  "/opt/newapi-alipay-gateway.backup.$(date +%Y%m%d%H%M%S)"
cd /opt/newapi-alipay-gateway
```

保留旧 `.env` 和 `secrets/`，按新 `.env.example` 逐项合并。不要覆盖现有私钥和证书。新版本首次启动会创建 MariaDB 表。

```bash
docker compose down
docker compose up -d --build
docker compose ps
docker compose logs --tail=200 gateway
```

## 常规升级

```bash
cd /opt/newapi-alipay-gateway
bash scripts/backup-db.sh
git fetch --all --prune
git pull --ff-only
docker compose up -d --build
curl -fsS http://127.0.0.1:3100/healthz
# 将示例域名替换为自己的 NewAPI HTTPS 域名
curl -fsS https://newapi.example.com/epay/healthz
```

Prisma migration只向前执行。升级前必须保留数据库备份和当前 Git 提交号：

```bash
git rev-parse HEAD
docker image ls | grep newapi-epay
```

## 应用回滚

如果新版本只改应用代码、未做不可逆数据库变更：

```bash
git checkout <上一个已验证提交>
docker compose up -d --build gateway
```

如果迁移改变数据库结构，先停止网关，再由维护人员评估备份恢复。不要直接删除 Docker volume。恢复 SQL 会覆盖当前数据，必须先额外备份故障现场并核对目标文件。

## 旧目录紧急恢复

仅当新网关无法修复且业务需要紧急回退时：

1. `docker compose down` 停止新服务。
2. 将当前目录改名保存，不要删除。
3. 恢复升级前备份目录。
4. 使用旧版本原有启动方式启动。
5. 1Panel 仍指向 `127.0.0.1:3100` 时，验证旧网关是否支持 `/epay`；旧简化版可能再次出现 `Cannot POST /epay/submit.php`。

数据库恢复属于破坏性操作，不应在没有确认备份文件、目标容器和影响时间范围时执行。
