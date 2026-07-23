# API 说明

所有业务处理器同时注册无前缀和 `/epay` 前缀。部署在独立域名时可使用无前缀地址；当前 1Panel 部署应使用 `/epay` 地址。

## 路由

| 方法 | 无前缀 | 1Panel 路径 | 说明 |
|---|---|---|---|
| GET | `/healthz` | `/epay/healthz` | 数据库就绪检查 |
| GET/POST | `/submit.php` | `/epay/submit.php` | EPay 下单并返回支付宝表单 |
| GET/POST | `/query.php`、`/api.php` | `/epay/query.php`、`/epay/api.php` | EPay 订单查询 |
| POST | `/alipay/notify` | `/epay/alipay/notify` | 支付宝异步通知 |
| GET | `/alipay/return` | `/epay/alipay/return` | 支付宝同步返回，仅验签和跳转 |
| GET | `/admin` | `/epay/admin` | Basic Auth 订单管理 |

## EPay 下单

内容类型为 `application/x-www-form-urlencoded`。字段：

```text
pid type out_trade_no notify_url return_url name money
device clientip param sign_type sign
```

`device`、`clientip`、`param` 可选。签名步骤：移除 `sign`、`sign_type` 和空值；按参数名 ASCII 升序；拼接 `key=value&...`；末尾直接附加 EPay KEY；计算小写 MD5。

成功返回 `text/html; charset=utf-8` 的支付宝 POST 表单。错误返回 JSON 和相应的 4xx 状态码。

## EPay 查询

参数：

```text
act=order
pid=<EPAY_PID>
key=<EPAY_KEY>
out_trade_no=<NewAPI订单号>
```

也可用 `trade_no` 代替 `out_trade_no`。成功示例：

```json
{
  "code": 1,
  "msg": "success",
  "trade_no": "20260723220000000001",
  "out_trade_no": "NA202607230001",
  "type": "alipay",
  "status": 1,
  "money": "1.00"
}
```

`status`：`0` 待支付、`1` 已支付/已完成、`2` 已关闭。

## 支付宝异步通知

接收支付宝原始表单字段，使用官方 SDK 证书模式验签，并校验：

- `app_id`
- `seller_id`
- `out_trade_no`
- `trade_no`
- `trade_status` 为 `TRADE_SUCCESS` 或 `TRADE_FINISHED`
- `total_amount` 与本地整数分金额一致

只有 NewAPI 回调返回 HTTP 2xx 且正文去空白后严格等于 `success`，网关才向支付宝返回 `success`。否则返回 `fail`/HTTP 503 并进入后台重试。

## NewAPI 通知

网关向配置的固定白名单 URL 发送：

```text
pid trade_no out_trade_no type name money trade_status sign_type sign
```

内容类型为 `application/x-www-form-urlencoded`，签名规则与 EPay 下单相同。客户端传入的任意 URL 不会被用于网络请求。

## 管理接口

管理接口启用后必须通过 HTTPS 访问，并使用 `ADMIN_USERNAME` 和 bcrypt 哈希对应的密码进行 Basic Auth。

- `GET /epay/admin`：最近 100 条订单、订单号搜索
- `POST /epay/admin/orders/:outTradeNo/retry`：手动重试 NewAPI 通知
- `POST /epay/admin/orders/:outTradeNo/query`：主动查询支付宝并自动补单
