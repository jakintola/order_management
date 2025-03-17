import { PrismaClient, OrderStatus, PaymentStatus, PaymentMethod, OrderPlatform } from '@prisma/client';
import { aiService } from './AIService';
import { communicationService } from './CommunicationService';

const prisma = new PrismaClient();

class OrderService {
  private readonly FRAUD_THRESHOLD = parseFloat(process.env.AI_FRAUD_THRESHOLD || '0.7');

  async createOrder(data: {
    customerId: string;
    items: Array<{ productName: string; quantity: number; unitPrice: number }>;
    deliveryAddress: string;
    paymentMethod: PaymentMethod;
    platform: OrderPlatform;
  }) {
    try {
      // Calculate total amount
      const totalAmount = data.items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0
      );

      // Create the order
      const order = await prisma.order.create({
        data: {
          orderNumber: this.generateOrderNumber(),
          customerId: data.customerId,
          totalAmount,
          paymentMethod: data.paymentMethod,
          deliveryAddress: data.deliveryAddress,
          platform: data.platform,
          items: {
            create: data.items.map(item => ({
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.quantity * item.unitPrice,
            })),
          },
        },
        include: {
          customer: true,
          items: true,
        },
      });

      // Assess fraud risk for CoD orders
      if (data.paymentMethod === 'CASH_ON_DELIVERY') {
        const fraudScore = await this.assessFraudRisk(order);
        
        if (fraudScore > this.FRAUD_THRESHOLD) {
          await this.handleFraudulentOrder(order);
          return null;
        }

        // Update order with fraud score
        await prisma.order.update({
          where: { id: order.id },
          data: { fraudScore },
        });
      }

      // Notify customer
      await this.notifyCustomer(order);

      return order;
    } catch (error) {
      console.error('Error creating order:', error);
      throw error;
    }
  }

  private generateOrderNumber(): string {
    return `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  private async assessFraudRisk(order: any): Promise<number> {
    try {
      return await aiService.assessFraudRisk(order);
    } catch (error) {
      console.error('Error assessing fraud risk:', error);
      // Default to a moderate risk score if assessment fails
      return 0.5;
    }
  }

  private async handleFraudulentOrder(order: any): Promise<void> {
    try {
      // Update order status
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          notes: 'Order cancelled due to high fraud risk',
        },
      });

      // Notify customer
      const message = `We apologize, but we cannot process your order at this time. Please contact our support team for assistance.`;
      await communicationService.sendMessage(
        order.platform,
        order.customer.phone!,
        message
      );

      // Create support ticket for review
      // This would integrate with your support ticket system
      console.log(`Support ticket created for fraudulent order ${order.id}`);
    } catch (error) {
      console.error('Error handling fraudulent order:', error);
      throw error;
    }
  }

  private async notifyCustomer(order: any): Promise<void> {
    try {
      const message = `Thank you for your order! Your order number is ${order.orderNumber}. We will notify you once it's ready for delivery.`;
      await communicationService.sendMessage(
        order.platform,
        order.customer.phone!,
        message
      );
    } catch (error) {
      console.error('Error notifying customer:', error);
      throw error;
    }
  }

  async processDelivery(orderId: string) {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true },
      });

      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }

      // Create delivery record
      const delivery = await prisma.delivery.create({
        data: {
          orderId,
          agentId: await this.assignDeliveryAgent(),
          scheduledTime: this.calculateDeliveryTime(),
        },
        include: {
          agent: true,
        },
      });

      // Update order status
      await prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.IN_DELIVERY },
      });

      // Notify customer
      const message = `Your order ${order.orderNumber} is out for delivery! Your delivery agent ${delivery.agent.name} will arrive at approximately ${delivery.scheduledTime.toLocaleTimeString()}.`;
      await communicationService.sendMessage(
        order.platform,
        order.customer.phone!,
        message
      );

      return delivery;
    } catch (error) {
      console.error('Error processing delivery:', error);
      throw error;
    }
  }

  private async assignDeliveryAgent(): Promise<string> {
    // Implement your delivery agent assignment logic here
    // This could involve checking agent availability, location, etc.
    const availableAgent = await prisma.user.findFirst({
      where: {
        role: 'DELIVERY_AGENT',
        // Add more conditions for availability
      },
    });

    if (!availableAgent) {
      throw new Error('No delivery agents available');
    }

    return availableAgent.id;
  }

  private calculateDeliveryTime(): Date {
    // Implement your delivery time calculation logic here
    // This could consider factors like distance, traffic, etc.
    const deliveryTime = new Date();
    deliveryTime.setHours(deliveryTime.getHours() + 1); // Default to 1 hour from now
    return deliveryTime;
  }

  async handleDeliveryDelay(deliveryId: string) {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          order: {
            include: { customer: true },
          },
        },
      });

      if (!delivery) {
        throw new Error(`Delivery ${deliveryId} not found`);
      }

      // Check if delay requires human intervention
      await aiService.handleDeliveryDelay(delivery);

      // Notify customer about delay
      await communicationService.notifyDeliveryDelay(delivery);

      return delivery;
    } catch (error) {
      console.error('Error handling delivery delay:', error);
      throw error;
    }
  }

  async requestRedelivery(orderId: string) {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          deliveries: true,
          customer: true,
        },
      });

      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }

      // Check if redelivery is allowed
      if (order.deliveries.length >= 2) {
        throw new Error('Maximum redelivery attempts reached');
      }

      // Create new delivery attempt
      const redelivery = await prisma.delivery.create({
        data: {
          orderId,
          agentId: await this.assignDeliveryAgent(),
          scheduledTime: this.calculateDeliveryTime(),
          attemptCount: order.deliveries.length + 1,
        },
        include: {
          agent: true,
        },
      });

      // Notify customer
      const message = `Your redelivery request for order ${order.orderNumber} has been scheduled. Your delivery agent ${redelivery.agent.name} will arrive at approximately ${redelivery.scheduledTime.toLocaleTimeString()}.`;
      await communicationService.sendMessage(
        order.platform,
        order.customer.phone!,
        message
      );

      return redelivery;
    } catch (error) {
      console.error('Error requesting redelivery:', error);
      throw error;
    }
  }
}

export const orderService = new OrderService(); 