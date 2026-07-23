# NewAPI EPay 支付网关

一个面向生产部署的 NewAPI EPay 兼容网关，将 NewAPI 的 EPay/MD5 协议转换为支付宝电脑网站支付的证书/RSA2 协议。项目原生支持 1Panel/OpenResty 保留 `/epay` 前缀的反向代理方式，无需修改 NewAPI 源码，也无需配置 URI Rewrite。

## 主要能力

- 同时支持 `/submit.php` 与 `/epay/submit.php`，以及通知、返回、查询、健康检查的双路由别名
- EPay MD5 请求验签和通知签名，签名比较使用定时安全比较
- 支付宝官方 Node.js SDK、公钥证书模式、RSA2、PKCS8
- MariaDB + Prisma 订单持久化，金额按整数分保存
- 重复下单校验、支付宝通知幂等、并发回调抢占锁
- NewAPI 回调精确判断 `HTTP 2xx + success`，失败阶梯退避重试
- 支付宝主动查单、超时关单、最小订单管理页
- URL 严格白名单、限流、安全响应头、日志脱敏
- 非 root、只读文件系统、仅回环端口暴露的 Docker Compose 部署

## 快速开始

生产部署请直接阅读 [服务器部署教程](docs/服务器部署教程.md)，不要使用示例密钥启动正式服务。

```bash
cp .env.example .env
mkdir -p secrets
# 填写 .env，并将四个支付宝密钥/证书文件放入 secrets/
docker compose up -d --build
curl -i http://127.0.0.1:3100/epay/healthz
```

本地开发：

```bash
npm ci
npm run db:generate
npm run check
npm run build
```

## 默认公网配置

| 项目 | 值 |
|---|---|
| EPay 端点 | `https://ltj666.ltd/epay` |
| 支付宝异步通知 | `https://ltj666.ltd/epay/alipay/notify` |
| 支付宝同步返回 | `https://ltj666.ltd/epay/alipay/return` |
| NewAPI 通知 | `https://ltj666.ltd/api/user/epay/notify` |
| NewAPI 返回页 | `https://ltj666.ltd/usage-logs` |
| 网关本机端口 | `127.0.0.1:3100` |

## 文档

- [服务器部署教程（含 NewAPI 与支付宝配置）](docs/服务器部署教程.md)
- [API 说明](docs/API.md)
- [安全说明](docs/SECURITY.md)
- [升级与回滚](docs/UPGRADE.md)
- [测试报告](docs/TEST_REPORT.md)

## 打包与备份

```bash
bash scripts/package.sh
bash scripts/backup-db.sh
```

打包脚本只收集 Git 已跟踪或未被 `.gitignore` 排除的文件，并在生成后再次检查 `.env`、私钥和证书。输出为 `newapi-epay-gateway.zip`。

## 许可证

[MIT](LICENSE)
