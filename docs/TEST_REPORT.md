# 测试报告

测试日期：2026-07-23

## 自动化结果

```text
npm run typecheck  通过
npm test           通过：3 个测试文件，25 项测试
npm run build      通过
npm audit --omit=dev --registry=https://registry.npmjs.org
                   通过：0 个已知漏洞
```

覆盖范围：

- EPay MD5 参数排序、空值排除、生成与验签
- 严格金额解析、格式化和非法金额拒绝
- `/submit.php` 与 `/epay/submit.php` 路由等价
- 回调 URL 白名单/SSRF 防护
- 重复订单重放与关键参数冲突拒绝
- `/alipay/notify` 与 `/epay/alipay/notify` 路由等价
- 支付宝金额不一致拒绝
- 支付通知幂等，重复通知不重复调用 NewAPI
- NewAPI 首次失败保留支付订单，后续重试完成
- EPay 订单查询接口

## 环境限制

当前开发机未安装 Docker，因此没有在本机实际构建镜像或启动 MariaDB Compose。Dockerfile、Compose、Prisma schema 和 migration 已完成静态检查，TypeScript 生产构建已通过。首次服务器部署仍须按部署教程执行以下验收：

- `docker compose config --quiet`
- `docker compose up -d --build`
- 两个容器健康检查
- 本机和公网双健康路由
- 支付宝沙箱完整支付
- 正式环境小额支付
- NewAPI 停机后的回调自动重试
- 重复支付宝通知不重复增加额度

真实支付宝证书、私钥和账号未提供给测试环境，因此 RSA2 真机签名/验签必须在服务器使用实际应用配置完成。
