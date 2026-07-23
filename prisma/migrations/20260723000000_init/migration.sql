CREATE TABLE `orders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `out_trade_no` VARCHAR(64) NOT NULL,
  `epay_pid` VARCHAR(32) NOT NULL,
  `pay_type` VARCHAR(16) NOT NULL,
  `subject` VARCHAR(256) NOT NULL,
  `amount_cents` INTEGER NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'CNY',
  `newapi_notify_url` VARCHAR(512) NOT NULL,
  `newapi_return_url` VARCHAR(512) NOT NULL,
  `client_param` VARCHAR(512) NULL,
  `status` ENUM('WAIT_PAY','PAID','COMPLETED','CLOSED','REFUNDED','FAILED') NOT NULL DEFAULT 'WAIT_PAY',
  `alipay_trade_no` VARCHAR(64) NULL,
  `alipay_buyer_id` VARCHAR(64) NULL,
  `alipay_buyer_logon_id_masked` VARCHAR(128) NULL,
  `alipay_trade_status` VARCHAR(32) NULL,
  `paid_at` DATETIME(3) NULL,
  `expired_at` DATETIME(3) NOT NULL,
  `last_queried_at` DATETIME(3) NULL,
  `newapi_notified_at` DATETIME(3) NULL,
  `newapi_notify_status` ENUM('PENDING','PROCESSING','SUCCESS','FAILED') NOT NULL DEFAULT 'PENDING',
  `newapi_notify_attempts` INTEGER NOT NULL DEFAULT 0,
  `newapi_notify_last_error` VARCHAR(1024) NULL,
  `newapi_notify_next_at` DATETIME(3) NULL,
  `newapi_notify_locked_at` DATETIME(3) NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `orders_out_trade_no_key` (`out_trade_no`),
  UNIQUE INDEX `orders_alipay_trade_no_key` (`alipay_trade_no`),
  INDEX `orders_status_expired_at_idx` (`status`, `expired_at`),
  INDEX `orders_newapi_notify_status_newapi_notify_next_at_idx` (`newapi_notify_status`, `newapi_notify_next_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `external_id` VARCHAR(128) NULL,
  `payload_summary` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `payment_events_order_id_created_at_idx` (`order_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notify_attempts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `http_status` INTEGER NULL,
  `response_summary` VARCHAR(512) NULL,
  `error_type` VARCHAR(64) NULL,
  `duration_ms` INTEGER NOT NULL,
  `succeeded` BOOLEAN NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `notify_attempts_order_id_created_at_idx` (`order_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_events` ADD CONSTRAINT `payment_events_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `notify_attempts` ADD CONSTRAINT `notify_attempts_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
