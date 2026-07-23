# NewAPI 自建 EPay 支付网关实施规格

## 1. 文档目的

本文档用于指导 Codex 从零实现并交付一个可部署的、兼容 NewAPI EPay 配置的支付宝支付网关。

项目需解决以下问题：

1. NewAPI 只支持填写 EPay 端点、回调地址、商户 ID 和商户密钥，不能直接填写支付宝 APPID、应用私钥和证书。
2. 当前服务器没有额外域名，也没有额外服务器。
3. NewAPI 和支付网关部署在同一台 Ubuntu 服务器。
4. 1Panel/OpenResty 当前通过 `/epay` 路径反向代理到本地端口 `3100`，但不会自动去掉 `/epay` 前缀。
5. 当前简化版网关只实现 `/submit.php`，因此访问 `/epay/submit.php` 时返回 `Cannot POST /epay/submit.php`。
6. 需要升级为完整、可维护、具备订单持久化、回调重试、幂等处理和安全校验的 EPay 网关。

本文档既是需求说明，也是实现规格、部署手册和验收清单。

---

## 2. 示例部署环境

### 2.1 服务器

- 操作系统：Ubuntu Linux
- 管理面板：1Panel
- Web 服务：1Panel 管理的 OpenResty
- Docker：已安装
- Docker Compose：已安装
- 公网域名：`https://newapi.example.com`（部署时替换为自己的域名）
- 没有额外域名
- 没有额外服务器

### 2.2 NewAPI

- 公网地址：`https://newapi.example.com`
- 本地监听：`127.0.0.1:3000`
- OpenResty 根路径代理：`/` → `http://127.0.0.1:3000`

### 2.3 支付网关

- 计划本地监听：`127.0.0.1:3100`
- 公网入口：`https://newapi.example.com/epay`
- OpenResty 路径代理：`/epay` → `http://127.0.0.1:3100`
- 1Panel 自动生成的实际配置：

```nginx
location /epay {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header REMOTE-HOST $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $http_connection;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_http_version 1.1;
    add_header X-Cache $upstream_cache_status;
    proxy_ssl_server_name off;
    proxy_ssl_name $proxy_host;
}
```

该配置不会去掉 `/epay` 前缀。

实际转发结果：

```text
POST https://newapi.example.com/epay/submit.php
→ POST http://127.0.0.1:3100/epay/submit.php
```

因此新网关必须原生支持 `/epay/*` 路由，不能依赖 OpenResty 重写 URI。

---

## 3. 已确认的现象与根因

已执行：

```bash
curl -X POST http://127.0.0.1:3100/submit.php
```

返回：

```text
支付请求无效
```

说明当前网关存在 `/submit.php` 路由。

执行：

```bash
curl -X POST http://127.0.0.1:3100/epay/submit.php
```

返回：

```text
Cannot POST /epay/submit.php
```

执行：

```bash
curl -v -X POST https://newapi.example.com/epay/submit.php
```

返回 HTTP 404：

```text
Cannot POST /epay/submit.php
```

结论：

- Docker 容器正常；
- OpenResty 代理正常；
- HTTPS 正常；
- NewAPI 已正确请求 `/epay/submit.php`；
- 根因是网关没有注册 `/epay/submit.php`；
- 不是支付宝 APPID、证书、PID、KEY 或 NewAPI 的问题。

---

## 4. 目标架构

```text
用户浏览器
   │
   ▼
https://newapi.example.com
   │
   ├── /             → OpenResty → 127.0.0.1:3000 → NewAPI
   │
   └── /epay/*       → OpenResty → 127.0.0.1:3100/epay/* → EPay 网关
                                                            │
                                                            ▼
                                                  支付宝开放平台 OpenAPI
                                                            │
                                                            ▼
                                    /epay/alipay/notify ← 支付宝异步通知
                                                            │
                                                            ▼
                                  /api/user/epay/notify → NewAPI 增加额度
```

必须满足：

1. NewAPI 不修改源码。
2. OpenResty 不依赖 URI Rewrite。
3. 网关同时支持无前缀和 `/epay` 前缀。
4. 支付宝参数只配置在网关，不配置到 NewAPI。
5. NewAPI 和网关之间使用 EPay PID、KEY 和 MD5 签名。
6. 网关和支付宝之间使用 APPID、RSA2、证书模式。
7. 支付网关端口只绑定 `127.0.0.1:3100`。
8. 数据库不暴露公网。

---

## 5. 项目目标

项目名建议：

```text
newapi-epay-gateway
```

### 5.1 必须支持

- NewAPI EPay 下单
- 支付宝电脑网站支付
- 支付宝公钥证书模式
- RSA2 请求签名
- 支付宝异步通知验签
- EPay MD5 请求验签
- EPay MD5 通知签名
- 订单持久化
- 金额校验
- APPID 校验
- seller_id 校验
- 支付通知幂等
- NewAPI 回调失败重试
- 主动查询支付宝订单
- 支付成功后自动通知 NewAPI
- `/submit.php`
- `/epay/submit.php`
- `/alipay/notify`
- `/epay/alipay/notify`
- `/alipay/return`
- `/epay/alipay/return`
- 健康检查
- 日志脱敏
- Docker Compose 一键部署

### 5.2 建议支持

- EPay 订单查询接口
- 管理员手动重试通知
- 订单列表管理页面
- 每日对账基础能力
- 订单关闭
- 支付宝退款
- 审计日志
- 数据库备份脚本

### 5.3 第一版暂不实现

- 微信支付正式接入
- 多租户 EPay 商户
- 多支付宝应用
- 资金结算
- 代付
- 分账
- 多币种
- SaaS 商户入驻

可预留接口，但不得影响支付宝单商户版本的稳定性。

---

## 6. 推荐技术栈

- Node.js 22 LTS
- TypeScript
- Express
- 支付宝官方 Node.js SDK
- Prisma ORM
- MariaDB
- Pino 日志
- Zod 配置校验
- Docker Compose
- Vitest
- Supertest

MariaDB 作为生产默认数据库，原因：

- 支持并发、事务和可靠持久化；
- 后续管理后台、对账和退款更容易扩展；
- 订单数据不应依赖临时内存或单个 JSON 文件。

---

## 7. 推荐目录结构

```text
newapi-epay-gateway/
├── compose.yaml
├── Dockerfile
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── LICENSE
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── secrets/
│   └── .gitkeep
│
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config.ts
│   │
│   ├── routes/
│   │   ├── epay-submit.ts
│   │   ├── epay-query.ts
│   │   ├── alipay-notify.ts
│   │   ├── alipay-return.ts
│   │   ├── admin.ts
│   │   └── health.ts
│   │
│   ├── services/
│   │   ├── epay-sign.ts
│   │   ├── alipay-client.ts
│   │   ├── alipay-order.ts
│   │   ├── order-service.ts
│   │   ├── newapi-notify.ts
│   │   └── retry-service.ts
│   │
│   ├── repositories/
│   │   ├── order-repository.ts
│   │   └── event-repository.ts
│   │
│   ├── jobs/
│   │   ├── retry-newapi-notify.ts
│   │   ├── query-pending-orders.ts
│   │   └── close-expired-orders.ts
│   │
│   ├── middleware/
│   │   ├── request-id.ts
│   │   ├── error-handler.ts
│   │   ├── rate-limit.ts
│   │   └── security-headers.ts
│   │
│   ├── utils/
│   │   ├── money.ts
│   │   ├── time.ts
│   │   ├── redact.ts
│   │   └── http.ts
│   │
│   └── types/
│       ├── epay.ts
│       └── alipay.ts
│
└── tests/
    ├── epay-sign.test.ts
    ├── submit.test.ts
    ├── notify.test.ts
    ├── idempotency.test.ts
    └── retry.test.ts
```

---

## 8. 支付宝证书与密钥

部署前应准备：

```text
alipayCertPublicKey_RSA2.crt
alipayRootCert.crt
appCertPublicKey_YOUR_APP_ID.crt
应用私钥RSA2048-敏感数据，请妥善保管.txt
应用公钥RSA2048.txt
CSR 文件
```

运行时需要：

```text
app_private_key.pem
appCertPublicKey.crt
alipayCertPublicKey_RSA2.crt
alipayRootCert.crt
```

运行时不需要：

```text
应用公钥RSA2048.txt
CSR 文件
```

### 8.1 私钥格式

若私钥正文以 `MIIEv...` 开头且没有 PEM 头尾，应先转换格式。

应转换为 PKCS8 PEM：

```text
-----BEGIN PRIVATE KEY-----
MIIEv...
-----END PRIVATE KEY-----
```

文件名：

```text
app_private_key.pem
```

环境变量：

```env
ALIPAY_KEY_TYPE=PKCS8
```

必须校验私钥和应用公钥证书是否匹配。

```bash
openssl pkey \
  -in secrets/app_private_key.pem \
  -pubout \
  -outform DER | sha256sum
```

```bash
openssl x509 \
  -in secrets/appCertPublicKey.crt \
  -pubkey \
  -noout |
openssl pkey \
  -pubin \
  -outform DER | sha256sum
```

两者必须一致。

---

## 9. 环境变量设计

提供 `.env.example`：

```env
NODE_ENV=production
PORT=3100
LOG_LEVEL=info

# EPay：NewAPI 与网关之间
EPAY_PID=10001
EPAY_KEY=replace_with_random_64_hex
EPAY_TYPE=alipay

# 金额限制
MIN_AMOUNT=0.01
MAX_AMOUNT=100.00

# 公网 URL
GATEWAY_PUBLIC_URL=https://newapi.example.com/epay
NEWAPI_NOTIFY_URL=https://newapi.example.com/api/user/epay/notify
NEWAPI_RETURN_URL=https://newapi.example.com/usage-logs

# 支付宝
ALIPAY_APP_ID=replace_with_alipay_app_id
ALIPAY_SELLER_ID=replace_with_2088_merchant_pid
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
ALIPAY_KEY_TYPE=PKCS8
ALIPAY_PRIVATE_KEY_PATH=/run/secrets/app_private_key.pem
ALIPAY_APP_CERT_PATH=/run/secrets/appCertPublicKey.crt
ALIPAY_PUBLIC_CERT_PATH=/run/secrets/alipayCertPublicKey_RSA2.crt
ALIPAY_ROOT_CERT_PATH=/run/secrets/alipayRootCert.crt

# 数据库
DB_PASSWORD=replace_with_strong_password
DB_ROOT_PASSWORD=replace_with_another_strong_password
DATABASE_URL=mysql://epay_gateway:${DB_PASSWORD}@db:3306/epay_gateway

# 重试
NOTIFY_RETRY_ENABLED=true
NOTIFY_RETRY_INTERVAL_SECONDS=60
NOTIFY_RETRY_MAX_COUNT=20
PENDING_QUERY_INTERVAL_SECONDS=120
ORDER_EXPIRE_MINUTES=30

# 管理接口
ADMIN_ENABLED=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=
ADMIN_SESSION_SECRET=

# 安全
TRUST_PROXY=true
RATE_LIMIT_ENABLED=true
ALLOWED_NEWAPI_NOTIFY_URL=https://newapi.example.com/api/user/epay/notify
ALLOWED_NEWAPI_RETURN_URL=https://newapi.example.com/usage-logs
```

启动时必须用 Zod 或同类方式校验必填项。

缺少证书、APPID、EPAY_KEY、数据库连接等关键配置时，进程必须退出，不能带错误配置运行。

---

## 10. EPay 协议要求

### 10.1 下单地址

必须支持：

```text
POST /submit.php
GET  /submit.php
POST /epay/submit.php
GET  /epay/submit.php
```

所有路由调用同一个处理函数。

### 10.2 NewAPI 下单字段

必须兼容：

```text
pid
type
out_trade_no
notify_url
return_url
name
money
device
sign_type
sign
```

可能还会出现：

```text
clientip
param
```

### 10.3 EPay 签名算法

签名规则：

1. 去掉 `sign`
2. 去掉 `sign_type`
3. 去掉值为空的参数
4. 参数名按 ASCII 字典序排序
5. 拼接为 `key=value&key=value`
6. 末尾直接追加 `EPAY_KEY`
7. 计算 MD5
8. 输出小写十六进制字符串

伪代码：

```ts
function createEpaySign(
  params: Record<string, unknown>,
  key: string
): string {
  const content = Object.entries(params)
    .filter(([name, value]) => {
      return (
        name !== "sign" &&
        name !== "sign_type" &&
        value !== undefined &&
        value !== null &&
        String(value) !== ""
      );
    })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join("&");

  return md5(content + key).toLowerCase();
}
```

比较签名时使用定时安全比较，避免普通字符串直接比较。

### 10.4 下单校验

必须校验：

- `pid === EPAY_PID`
- `type === alipay`
- `sign_type === MD5`
- EPay 签名正确
- `out_trade_no` 格式和长度
- `money` 是有效十进制金额
- 金额在允许范围内
- `notify_url` 严格等于允许的 NewAPI 回调地址
- `return_url` 严格等于允许的 NewAPI 返回地址
- 同一订单号重复下单时，金额和商品名称不能变化
- 防止订单号注入、HTML 注入和日志注入

### 10.5 下单响应

成功后返回支付宝网页支付 HTML。

```http
Content-Type: text/html; charset=utf-8
```

使用支付宝官方 SDK 的 `pageExecute` 或等价功能生成表单。

支付宝请求参数：

```text
method=alipay.trade.page.pay
product_code=FAST_INSTANT_TRADE_PAY
out_trade_no=<NewAPI 订单号>
total_amount=<订单金额>
subject=<商品名称>
notify_url=https://newapi.example.com/epay/alipay/notify
return_url=https://newapi.example.com/epay/alipay/return
```

---

## 11. 支付宝 OpenAPI 要求

### 11.1 使用证书模式

SDK 初始化需要：

```text
APPID
应用私钥
应用公钥证书
支付宝公钥证书
支付宝根证书
RSA2
PKCS8
```

### 11.2 支付宝开放平台配置

需要：

- 创建自用型网页应用
- 开通电脑网站支付
- 配置接口加签方式为公钥证书模式
- 上传 CSR
- 下载三个证书
- 应用上线
- 支付产品处于可用状态
- 服务器 IP 固定后，建议配置服务器 IP 白名单

不需要填写：

- 应用网关
- OAuth 授权回调地址
- AES 内容加密密钥

基础支付通知 URL 由网关下单时提交，不依赖支付宝后台的“应用网关”。

### 11.3 支付宝异步通知

必须支持：

```text
POST /alipay/notify
POST /epay/alipay/notify
```

两者调用同一个处理函数。

处理流程：

1. 读取 `application/x-www-form-urlencoded`
2. 使用支付宝官方 SDK 验签
3. 校验 `app_id`
4. 校验 `seller_id`
5. 校验 `trade_status`
6. 查找本地订单
7. 校验 `out_trade_no`
8. 校验 `total_amount`
9. 校验支付宝交易号
10. 更新订单状态
11. 通知 NewAPI
12. NewAPI 返回精确的 `success` 后，才向支付宝返回 `success`
13. 如果通知 NewAPI 失败，返回 `fail` 或 HTTP 5xx，并记录重试任务

支持的成功状态：

```text
TRADE_SUCCESS
TRADE_FINISHED
```

已成功入账订单必须保持幂等。

### 11.4 同步返回

必须支持：

```text
GET /alipay/return
GET /epay/alipay/return
```

同步返回只负责：

- 验签
- 展示支付结果
- 重定向到 NewAPI 充值记录页面

不能依赖同步返回入账。

建议：

```text
303 → https://newapi.example.com/usage-logs
```

---

## 12. NewAPI 回调协议

网关向：

```text
POST https://newapi.example.com/api/user/epay/notify
```

发送：

```text
pid
trade_no
out_trade_no
type
name
money
trade_status
sign_type
sign
```

建议内容：

```text
pid=<EPAY_PID>
trade_no=<支付宝 trade_no>
out_trade_no=<NewAPI 订单号>
type=alipay
name=<原订单商品名称>
money=<原订单金额>
trade_status=TRADE_SUCCESS
sign_type=MD5
sign=<EPay MD5 签名>
```

请求类型：

```text
application/x-www-form-urlencoded
```

只有同时满足以下条件才算通知成功：

```text
HTTP 2xx
响应正文 trim 后严格等于 success
```

不能只判断 HTTP 200。

---

## 13. 订单数据模型

建议订单表 `orders` 至少包含：

```text
id
out_trade_no
epay_pid
pay_type
subject
amount_cents
currency
newapi_notify_url
newapi_return_url
status
alipay_trade_no
alipay_buyer_id
alipay_buyer_logon_id_masked
alipay_trade_status
paid_at
expired_at
newapi_notified_at
newapi_notify_status
newapi_notify_attempts
newapi_notify_last_error
created_at
updated_at
version
```

订单状态建议：

```text
CREATED
WAIT_PAY
PAID
NEWAPI_NOTIFY_PENDING
COMPLETED
CLOSED
REFUNDED
FAILED
```

金额必须用“分”保存：

```text
amount_cents: integer
```

禁止使用 JavaScript 浮点数直接比较金额。

金额转换必须严格：

```text
"1.00" → 100
"0.01" → 1
```

拒绝：

```text
NaN
Infinity
负数
超过两位小数
科学计数法
```

---

## 14. 幂等与并发

### 14.1 下单幂等

`out_trade_no` 唯一。

重复下单：

- 金额、商品和回调地址一致：返回已有订单支付页面或重新生成支付表单
- 任一关键参数不同：拒绝

### 14.2 支付通知幂等

以 `out_trade_no` 和 `alipay_trade_no` 校验。

同一通知重复到达：

- 不重复增加 NewAPI 额度
- 如果 NewAPI 尚未通知成功，可以继续重试
- 如果已经完成，直接向支付宝返回 `success`

### 14.3 数据库事务

收到支付宝通知时：

1. 加载订单
2. 锁定订单或使用乐观锁
3. 校验金额
4. 更新支付状态
5. 写入通知事件
6. 提交事务
7. 再调用 NewAPI

避免持有数据库事务等待外部 HTTP 请求。

---

## 15. 回调重试与补单

### 15.1 NewAPI 回调失败重试

定时扫描：

```text
status = PAID
newapi_notify_status != SUCCESS
attempts < MAX
```

建议退避：

```text
1 分钟
2 分钟
5 分钟
10 分钟
30 分钟
1 小时
```

每次记录：

```text
请求时间
HTTP 状态码
响应正文摘要
错误类型
耗时
```

### 15.2 主动查询支付宝

扫描长时间处于 `CREATED` 或 `WAIT_PAY` 的订单，调用：

```text
alipay.trade.query
```

如果支付宝显示成功：

- 校验金额
- 更新本地订单
- 通知 NewAPI

如果显示关闭：更新为 `CLOSED`。

### 15.3 订单过期

默认 30 分钟。

过期后可调用：

```text
alipay.trade.close
```

---

## 16. 路由兼容要求

必须同时注册以下路由别名：

```text
/healthz
/epay/healthz

/submit.php
/epay/submit.php

/query.php
/epay/query.php

/api.php
/epay/api.php

/alipay/notify
/epay/alipay/notify

/alipay/return
/epay/alipay/return
```

不要复制处理逻辑。应由同一 Handler 处理，例如：

```ts
app.all(
  ["/submit.php", "/epay/submit.php"],
  submitHandler
);
```

目标：

- 独立域名部署时可使用无前缀接口
- 1Panel 路径代理时可使用 `/epay` 前缀接口

---

## 17. EPay 查询接口

建议支持：

```text
GET/POST /api.php
GET/POST /epay/api.php
```

至少支持：

```text
act=order
```

校验：

```text
pid
key
out_trade_no 或 trade_no
```

返回示例：

```json
{
  "code": 1,
  "msg": "success",
  "trade_no": "支付宝交易号",
  "out_trade_no": "NewAPI订单号",
  "type": "alipay",
  "status": 1,
  "money": "1.00"
}
```

查询接口不得影响 NewAPI 主充值流程。

---

## 18. 安全要求

### 18.1 密钥

禁止写入源码：

```text
EPAY_KEY
支付宝应用私钥
数据库密码
管理员密码
Session Secret
```

### 18.2 日志脱敏

不得记录：

```text
完整应用私钥
完整 EPay KEY
完整数据库密码
完整 buyer_logon_id
完整签名原文
```

允许记录：

```text
APPID
订单号
金额
支付宝交易号
脱敏买家账户
回调状态
```

### 18.3 SSRF 防护

不能信任请求中的任意 `notify_url` 和 `return_url`。

必须严格匹配：

```text
https://newapi.example.com/api/user/epay/notify
https://newapi.example.com/usage-logs
```

不得请求：

```text
127.0.0.1
localhost
Docker 内网地址
任意外部 URL
```

### 18.4 HTTP 安全

- 启用 Helmet 或等价安全响应头
- 限制 body 大小
- 设置请求超时
- 对下单接口限流
- 正确处理 `X-Forwarded-For`
- 管理接口必须认证
- 管理接口默认不允许匿名访问

### 18.5 Docker

网关容器：

- 非 root 用户
- 只读根文件系统
- `/tmp` 使用 tmpfs
- `no-new-privileges`
- 证书目录只读
- 端口只绑定 `127.0.0.1:3100`

数据库：

- 不映射公网端口
- 单独数据库用户
- 最小权限

---

## 19. Docker Compose 要求

示例：

```yaml
services:
  gateway:
    build:
      context: .
    container_name: newapi-epay-gateway
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "127.0.0.1:3100:3100"
    volumes:
      - ./secrets:/run/secrets:ro
    depends_on:
      db:
        condition: service_healthy
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    networks:
      - epay

  db:
    image: mariadb:11
    container_name: newapi-epay-db
    restart: unless-stopped
    environment:
      MARIADB_DATABASE: epay_gateway
      MARIADB_USER: epay_gateway
      MARIADB_PASSWORD: ${DB_PASSWORD}
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
    volumes:
      - epay_db_data:/var/lib/mysql
    healthcheck:
      test:
        [
          "CMD",
          "healthcheck.sh",
          "--connect",
          "--innodb_initialized"
        ]
      interval: 10s
      timeout: 5s
      retries: 10
    networks:
      - epay

volumes:
  epay_db_data:

networks:
  epay:
```

---

## 20. 1Panel/OpenResty 配置

保持当前 1Panel 代理即可：

```text
前端路径：/epay
后端地址：http://127.0.0.1:3100
```

由于 1Panel 保留 `/epay` 前缀，新网关必须支持：

```text
/epay/submit.php
/epay/alipay/notify
/epay/alipay/return
```

不要求用户手动修改 1Panel 自动生成的配置。

验证：

```bash
curl -i https://newapi.example.com/epay/healthz
```

应返回 HTTP 200。

```bash
curl -X POST https://newapi.example.com/epay/submit.php
```

无参数时可以返回 HTTP 400 和业务错误，但不能返回：

```text
Cannot POST /epay/submit.php
404
502
NewAPI 页面
```

---

## 21. NewAPI 配置

NewAPI EPay 页面填写：

```text
EPay 端点：
https://newapi.example.com/epay

回调地址：
https://newapi.example.com

易支付商户 ID：
10001

EPay 密钥：
与网关 EPAY_KEY 完全一致
```

不能填写：

```text
https://newapi.example.com/epay/submit.php
```

因为 NewAPI 会在 EPay 端点后追加 `/submit.php`。

支付方式：

```json
[
  {
    "color": "rgba(var(--semi-blue-5), 1)",
    "name": "支付宝",
    "type": "alipay",
    "min_topup": "1"
  }
]
```

联调阶段：

```text
最低充值：1
充值价格：1
分组倍率：1
充值折扣：不配置
支付合规声明：确认
```

---

## 22. 支付宝开放平台配置

需要：

```text
应用类型：自用型网页应用
支付产品：电脑网站支付
接口：alipay.trade.page.pay
接口加签方式：公钥证书模式
支付宝网关：https://openapi.alipay.com/gateway.do
```

建议配置服务器 IP 白名单，填写当前服务器公网出口 IP：

```bash
curl -4 https://api.ipify.org
```

保持空白：

```text
应用网关
授权回调地址
```

支付异步通知由程序下单时设置：

```text
https://newapi.example.com/epay/alipay/notify
```

同步返回：

```text
https://newapi.example.com/epay/alipay/return
```

---

## 23. 管理后台

建议第一版提供最小后台：

```text
GET /epay/admin
```

功能：

- 管理员登录
- 订单列表
- 订单详情
- 按订单号查询
- 显示支付状态
- 显示 NewAPI 通知状态
- 手动重试 NewAPI 通知
- 主动查询支付宝
- 查看脱敏日志

第一版可以使用简单服务端渲染，不要求复杂前端框架。

禁止在后台展示：

```text
应用私钥
完整 EPAY_KEY
数据库密码
```

---

## 24. 测试要求

### 24.1 单元测试

必须覆盖：

- EPay MD5 签名生成
- EPay MD5 验签
- 参数排序
- 空值排除
- 金额解析
- 非法金额拒绝
- URL 白名单
- 重复订单
- 金额不一致
- 支付通知幂等

### 24.2 集成测试

模拟：

1. NewAPI 下单
2. 网关验签
3. 生成支付宝支付页面
4. 支付宝通知验签
5. NewAPI 回调返回 `success`
6. NewAPI 回调返回错误
7. 网络超时
8. 重复支付宝通知
9. 回调重试成功
10. 支付宝订单主动查询成功

### 24.3 路由兼容测试

以下路由必须行为一致：

```text
/submit.php
/epay/submit.php
```

以及：

```text
/alipay/notify
/epay/alipay/notify
```

### 24.4 真机测试

正式上线前：

- 先支付宝沙箱
- 再正式环境 0.01 元或 1 元
- 检查支付宝订单
- 检查网关数据库
- 检查 NewAPI 充值记录
- 检查用户额度
- 重复通知不得重复入账

---

## 25. 验收标准

### 25.1 部署

执行：

```bash
docker compose up -d --build
```

成功启动：

```text
newapi-epay-gateway
newapi-epay-db
```

健康检查：

```bash
curl -i http://127.0.0.1:3100/healthz
curl -i http://127.0.0.1:3100/epay/healthz
curl -i https://newapi.example.com/epay/healthz
```

全部返回 200。

### 25.2 路由

以下不再返回 `Cannot POST`：

```text
POST /submit.php
POST /epay/submit.php
```

### 25.3 支付

NewAPI 点击充值后：

1. 跳转支付宝收银台
2. 支付金额正确
3. 支付成功
4. 网关收到支付宝通知
5. NewAPI 返回 `success`
6. 用户额度只增加一次
7. 订单状态为完成

### 25.4 异常恢复

人为停止 NewAPI 后完成支付宝支付：

1. 网关记录支付成功
2. 通知 NewAPI 失败
3. 不丢失订单
4. NewAPI 恢复后自动重试
5. 最终用户额度到账
6. 不重复增加额度

---

## 26. 迁移当前简化版网关

当前目录：

```text
/opt/newapi-alipay-gateway
```

迁移步骤：

1. 备份旧目录：

```bash
sudo cp -a \
  /opt/newapi-alipay-gateway \
  /opt/newapi-alipay-gateway.backup
```

2. 保留：

```text
.env
secrets/
```

3. 用新项目替换代码
4. 根据新 `.env.example` 合并配置
5. 不要覆盖支付宝应用私钥和三个证书
6. 停止旧容器
7. 构建新容器
8. 执行数据库迁移
9. 验证健康检查
10. 再测试 NewAPI 充值

建议部署命令：

```bash
cd /opt/newapi-alipay-gateway

docker compose down

docker compose up -d --build

docker compose ps

docker compose logs --tail=200 gateway
```

---

## 27. Codex 实施顺序

### 阶段 1：项目骨架

- TypeScript
- Express
- 配置校验
- 日志
- Docker
- MariaDB
- Prisma
- 健康检查

### 阶段 2：EPay 核心

- MD5 签名
- `/submit.php`
- `/epay/submit.php`
- 参数校验
- 订单持久化
- URL 白名单

### 阶段 3：支付宝

- SDK 证书模式
- 网页支付
- 异步通知
- RSA2 验签
- APPID、seller_id、金额校验
- 同步返回

### 阶段 4：NewAPI 通知

- EPay 回调签名
- 表单 POST
- 精确判断 `success`
- 幂等
- 失败记录

### 阶段 5：可靠性

- 定时重试
- 主动查询
- 关闭过期订单
- 审计日志

### 阶段 6：后台

- 登录
- 订单列表
- 订单详情
- 手动重试
- 主动查询

### 阶段 7：测试与文档

- 单元测试
- 集成测试
- Docker 部署说明
- 1Panel 配置说明
- NewAPI 配置说明
- 支付宝配置说明
- 故障排查

---

## 28. Codex 最终交付物

Codex 必须交付：

```text
完整源码
Dockerfile
compose.yaml
.env.example
Prisma schema 和 migration
README.md
部署手册
安全说明
API 说明
测试代码
测试报告
升级说明
```

还要提供一键打包脚本，生成：

```text
newapi-epay-gateway.zip
```

压缩包中不能包含：

```text
.env
应用私钥
支付宝证书
数据库数据
日志
管理员密码
```

---

## 29. 给 Codex 的直接执行指令

可将下面内容作为 Codex 的首条任务：

> 请根据本文档实现一个可生产部署的 `newapi-epay-gateway`。  
> 使用 Node.js 22、TypeScript、Express、Prisma 和 MariaDB。  
> 网关必须同时支持 `/submit.php` 和 `/epay/submit.php`，因为当前 1Panel/OpenResty 会保留 `/epay` 前缀。  
> 使用支付宝官方 Node.js SDK、公钥证书模式、RSA2、PKCS8 应用私钥。  
> 必须实现 EPay MD5 签名、支付宝异步通知验签、APPID/seller_id/金额校验、订单持久化、幂等处理、NewAPI 通知失败重试、支付宝主动查询、健康检查和 Docker Compose 部署。  
> 不能依赖修改 NewAPI 源码，也不能依赖 OpenResty URI Rewrite。  
> 先实现可运行的最小版本和测试，再增加管理后台。  
> 每完成一个阶段，运行测试并输出变更摘要、风险点和下一阶段计划。  
> 不允许把密钥、证书、数据库密码写入源码或提交到 Git。

---

## 30. 关键结论

当前问题不是支付宝配置错误，而是路径兼容问题：

```text
1Panel 保留 /epay 前缀
+
旧网关只支持 /submit.php
=
Cannot POST /epay/submit.php
```

新网关必须通过路由别名原生支持：

```text
/submit.php
/epay/submit.php
```

同理，支付宝通知和返回也必须同时支持：

```text
/alipay/notify
/epay/alipay/notify

/alipay/return
/epay/alipay/return
```

最终目标：

```text
NewAPI 无需修改
1Panel 无需 URI Rewrite
支付宝使用官方证书模式
支付成功可可靠入账
网络异常后可自动补单
重复通知不会重复增加额度
```
