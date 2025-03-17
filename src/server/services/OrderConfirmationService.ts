import { PrismaClient, Order, OrderStatus } from '@prisma/client';
import { aiService } from './AIService';
import { communicationService } from './CommunicationService';

const prisma = new PrismaClient();

class OrderConfirmationService {
  private readonly CONFIRMATION_TIMEOUT = 15 * 60 * 1000; // 15 minutes
  private readonly FINAL_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
  private confirmationTimers: Map<string, NodeJS.Timeout> = new Map();

  async initiateConfirmation(orderId: string) {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true },
      });

      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }

      // Assess fraud risk first
      const fraudScore = await aiService.assessFraudRisk(order);
      
      if (fraudScore > parseFloat(process.env.AI_FRAUD_THRESHOLD || '0.7')) {
        await this.handleHighRiskOrder(order);
        return;
      }

      // Send confirmation request
      await this.sendConfirmationRequest(order);

      // Set confirmation timeout
      this.setConfirmationTimers(order);

    } catch (error) {
      console.error('Error initiating order confirmation:', error);
      throw error;
    }
  }

  private async sendConfirmationRequest(order: Order) {
    const message = `Please confirm your order #${order.orderNumber}:\n` +
      `Total Amount: $${order.totalAmount}\n` +
      `Delivery Address: ${order.deliveryAddress}\n\n` +
      `Reply with 'CONFIRM' to proceed with your order, or 'CANCEL' to cancel it.`;

    await communicationService.sendMessage(
      order.platform,
      order.customer.phone!,
      message
    );

    // Log the confirmation request
    await prisma.aIInteraction.create({
      data: {
        type: 'confirmation_request',
        content: message,
        metadata: {
          orderId: order.id,
          platform: order.platform,
        },
      },
    });
  }

  private setConfirmationTimers(order: Order) {
    // Set timer for human follow-up (15 minutes)
    const humanFollowupTimer = setTimeout(async () => {
      await this.initiateHumanFollowup(order);
    }, this.CONFIRMATION_TIMEOUT);

    // Set timer for auto-cancellation (2 hours)
    const cancellationTimer = setTimeout(async () => {
      await this.cancelUnconfirmedOrder(order);
    }, this.FINAL_TIMEOUT);

    // Store timers for cleanup if needed
    this.confirmationTimers.set(order.id, humanFollowupTimer);
    this.confirmationTimers.set(`${order.id}_cancel`, cancellationTimer);
  }

  private async initiateHumanFollowup(order: Order) {
    try {
      // Create support ticket for human follow-up
      await prisma.aIInteraction.create({
        data: {
          type: 'human_followup_required',
          content: `Order ${order.orderNumber} requires human follow-up - No confirmation received`,
          metadata: {
            orderId: order.id,
            customerPhone: order.customer.phone,
            orderDetails: {
              amount: order.totalAmount,
              address: order.deliveryAddress,
            },
          },
        },
      });

      // Notify customer about phone follow-up
      const message = `We haven't received your order confirmation. Our support team will contact you shortly at ${order.customer.phone} to confirm your order.`;
      await communicationService.sendMessage(
        order.platform,
        order.customer.phone!,
        message
      );

    } catch (error) {
      console.error('Error initiating human follow-up:', error);
      throw error;
    }
  }

  private async cancelUnconfirmedOrder(order: Order) {
    try {
      // Update order status
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          notes: 'Auto-cancelled due to no confirmation',
        },
      });

      // Notify customer
      const message = `Your order #${order.orderNumber} has been cancelled as we didn't receive confirmation within 2 hours. Please place a new order if you still wish to proceed.`;
      await communicationService.sendMessage(
        order.platform,
        order.customer.phone!,
        message
      );

      // Clear timers
      this.clearTimers(order.id);

    } catch (error) {
      console.error('Error cancelling unconfirmed order:', error);
      throw error;
    }
  }

  private async handleHighRiskOrder(order: Order) {
    try {
      // Update order status
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.PENDING,
          notes: 'High-risk order - Requires manual review',
        },
      });

      // Create high-priority support ticket
      await prisma.aIInteraction.create({
        data: {
          type: 'high_risk_order',
          content: `High-risk order ${order.orderNumber} requires manual review`,
          metadata: {
            orderId: order.id,
            fraudScore: order.fraudScore,
            customerDetails: {
              name: order.customer.name,
              phone: order.customer.phone,
              address: order.deliveryAddress,
            },
          },
        },
      });

      // Notify customer
      const message = `Your order #${order.orderNumber} is under review. Our team will contact you shortly to verify some details.`;
      await communicationService.sendMessage(
        order.platform,
        order.customer.phone!,
        message
      );

    } catch (error) {
      console.error('Error handling high-risk order:', error);
      throw error;
    }
  }

  async handleOrderConfirmation(orderId: string, confirmed: boolean) {
    try {
      if (confirmed) {
        await prisma.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.CONFIRMED,
          },
        });

        // Clear confirmation timers
        this.clearTimers(orderId);

        return true;
      } else {
        await this.cancelUnconfirmedOrder(await prisma.order.findUnique({
          where: { id: orderId },
          include: { customer: true },
        }) as Order);
        return false;
      }
    } catch (error) {
      console.error('Error handling order confirmation:', error);
      throw error;
    }
  }

  private clearTimers(orderId: string) {
    const followupTimer = this.confirmationTimers.get(orderId);
    const cancelTimer = this.confirmationTimers.get(`${orderId}_cancel`);

    if (followupTimer) {
      clearTimeout(followupTimer);
      this.confirmationTimers.delete(orderId);
    }

    if (cancelTimer) {
      clearTimeout(cancelTimer);
      this.confirmationTimers.delete(`${orderId}_cancel`);
    }
  }
}

export const orderConfirmationService = new OrderConfirmationService(); 