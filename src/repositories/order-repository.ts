import { Prisma, PrismaClient } from "@prisma/client";
import type {
  NewOrderInput,
  NotifyAttemptInput,
  OrderRecord,
  PaidOrderInput
} from "../types.js";

export interface OrderRepository {
  createOrGet(input: NewOrderInput): Promise<{ order: OrderRecord; created: boolean }>;
  findByOutTradeNo(outTradeNo: string): Promise<OrderRecord | null>;
  findByTradeNo(tradeNo: string): Promise<OrderRecord | null>;
  markPaid(order: OrderRecord, input: PaidOrderInput): Promise<OrderRecord>;
  claimNotification(orderId: bigint, maxAttempts: number): Promise<OrderRecord | null>;
  completeNotification(orderId: bigint): Promise<OrderRecord>;
  failNotification(orderId: bigint, error: string, nextAttemptAt: Date): Promise<OrderRecord>;
  recordNotifyAttempt(orderId: bigint, input: NotifyAttemptInput): Promise<void>;
  findNotificationsDue(limit: number, maxAttempts: number): Promise<OrderRecord[]>;
  findPendingOrders(limit: number, queriedBefore: Date): Promise<OrderRecord[]>;
  touchQueried(orderId: bigint): Promise<void>;
  closeOrder(orderId: bigint, reason: string): Promise<void>;
  listOrders(limit: number, query?: string): Promise<OrderRecord[]>;
  ping(): Promise<void>;
}

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createOrGet(input: NewOrderInput): Promise<{ order: OrderRecord; created: boolean }> {
    try {
      const order = await this.prisma.order.create({ data: input });
      await this.prisma.paymentEvent.create({
        data: { orderId: order.id, eventType: "ORDER_CREATED" }
      });
      return { order: order as OrderRecord, created: true };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const order = await this.prisma.order.findUnique({ where: { outTradeNo: input.outTradeNo } });
      if (!order) throw error;
      return { order: order as OrderRecord, created: false };
    }
  }

  async findByOutTradeNo(outTradeNo: string): Promise<OrderRecord | null> {
    return await this.prisma.order.findUnique({ where: { outTradeNo } }) as OrderRecord | null;
  }

  async findByTradeNo(tradeNo: string): Promise<OrderRecord | null> {
    return await this.prisma.order.findUnique({ where: { alipayTradeNo: tradeNo } }) as OrderRecord | null;
  }

  async markPaid(order: OrderRecord, input: PaidOrderInput): Promise<OrderRecord> {
    if (order.alipayTradeNo && order.alipayTradeNo !== input.alipayTradeNo) {
      throw new Error("订单已绑定其他支付宝交易号");
    }
    if (order.status === "COMPLETED") return order;
    if (order.status === "PAID" && order.alipayTradeNo === input.alipayTradeNo) return order;
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: {
          id: order.id,
          version: order.version,
          OR: [{ alipayTradeNo: null }, { alipayTradeNo: input.alipayTradeNo }]
        },
        data: {
          status: "PAID",
          alipayTradeNo: input.alipayTradeNo,
          alipayBuyerId: input.buyerId,
          alipayBuyerLogonIdMasked: input.buyerLogonIdMasked,
          alipayTradeStatus: input.tradeStatus,
          paidAt: input.paidAt,
          newapiNotifyStatus: "PENDING",
          newapiNotifyNextAt: new Date(),
          version: { increment: 1 }
        }
      });
      if (updated.count === 1) {
        await tx.paymentEvent.create({
          data: {
            orderId: order.id,
            eventType: "ALIPAY_PAID",
            externalId: input.alipayTradeNo,
            payloadSummary: { tradeStatus: input.tradeStatus }
          }
        });
      }
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (current.alipayTradeNo && current.alipayTradeNo !== input.alipayTradeNo) {
        throw new Error("并发通知的支付宝交易号不一致");
      }
      return current;
    });
    return result as OrderRecord;
  }

  async claimNotification(orderId: bigint, maxAttempts: number): Promise<OrderRecord | null> {
    const now = new Date();
    const staleLock = new Date(now.getTime() - 2 * 60_000);
    const result = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        status: "PAID",
        newapiNotifyAttempts: { lt: maxAttempts },
        newapiNotifyStatus: { not: "SUCCESS" },
        OR: [
          { newapiNotifyStatus: { not: "PROCESSING" } },
          { newapiNotifyLockedAt: { lt: staleLock } },
          { newapiNotifyLockedAt: null }
        ]
      },
      data: {
        newapiNotifyStatus: "PROCESSING",
        newapiNotifyLockedAt: now,
        newapiNotifyAttempts: { increment: 1 },
        version: { increment: 1 }
      }
    });
    if (result.count !== 1) return null;
    return await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } }) as OrderRecord;
  }

  async completeNotification(orderId: bigint): Promise<OrderRecord> {
    const order = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status: "COMPLETED",
          newapiNotifyStatus: "SUCCESS",
          newapiNotifiedAt: new Date(),
          newapiNotifyLockedAt: null,
          newapiNotifyNextAt: null,
          newapiNotifyLastError: null,
          version: { increment: 1 }
        }
      });
      await tx.paymentEvent.create({ data: { orderId, eventType: "NEWAPI_NOTIFIED" } });
      return updated;
    });
    return order as OrderRecord;
  }

  async failNotification(orderId: bigint, error: string, nextAttemptAt: Date): Promise<OrderRecord> {
    return await this.prisma.order.update({
      where: { id: orderId },
      data: {
        newapiNotifyStatus: "FAILED",
        newapiNotifyLastError: error.slice(0, 1024),
        newapiNotifyNextAt: nextAttemptAt,
        newapiNotifyLockedAt: null,
        version: { increment: 1 }
      }
    }) as OrderRecord;
  }

  async recordNotifyAttempt(orderId: bigint, input: NotifyAttemptInput): Promise<void> {
    await this.prisma.notifyAttempt.create({ data: { orderId, ...input } });
  }

  async findNotificationsDue(limit: number, maxAttempts: number): Promise<OrderRecord[]> {
    const now = new Date();
    const staleLock = new Date(now.getTime() - 2 * 60_000);
    return await this.prisma.order.findMany({
      where: {
        status: "PAID",
        newapiNotifyAttempts: { lt: maxAttempts },
        OR: [
          {
            newapiNotifyStatus: { in: ["PENDING", "FAILED"] },
            OR: [{ newapiNotifyNextAt: null }, { newapiNotifyNextAt: { lte: now } }]
          },
          {
            newapiNotifyStatus: "PROCESSING",
            OR: [{ newapiNotifyLockedAt: null }, { newapiNotifyLockedAt: { lte: staleLock } }]
          }
        ]
      },
      orderBy: { newapiNotifyNextAt: "asc" },
      take: limit
    }) as OrderRecord[];
  }

  async findPendingOrders(limit: number, queriedBefore: Date): Promise<OrderRecord[]> {
    return await this.prisma.order.findMany({
      where: {
        status: "WAIT_PAY",
        OR: [{ lastQueriedAt: null }, { lastQueriedAt: { lte: queriedBefore } }]
      },
      orderBy: { createdAt: "asc" },
      take: limit
    }) as OrderRecord[];
  }

  async touchQueried(orderId: bigint): Promise<void> {
    await this.prisma.order.update({ where: { id: orderId }, data: { lastQueriedAt: new Date() } });
  }

  async closeOrder(orderId: bigint, reason: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: "CLOSED", version: { increment: 1 } }
      }),
      this.prisma.paymentEvent.create({
        data: { orderId, eventType: "ORDER_CLOSED", payloadSummary: { reason: reason.slice(0, 200) } }
      })
    ]);
  }

  async listOrders(limit: number, query?: string): Promise<OrderRecord[]> {
    const args: Prisma.OrderFindManyArgs = {
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200)
    };
    if (query) args.where = { outTradeNo: { contains: query } };
    return await this.prisma.order.findMany(args) as OrderRecord[];
  }

  async ping(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}
