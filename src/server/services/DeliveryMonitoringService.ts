import { PrismaClient, Delivery, DeliveryStatus, OrderStatus } from '@prisma/client';
import { communicationService } from './CommunicationService';
import { aiService } from './AIService';
import { deliveryAssignmentService } from './DeliveryAssignmentService';

const prisma = new PrismaClient();

interface Location {
  latitude: number;
  longitude: number;
}

class DeliveryMonitoringService {
  private readonly DELAY_THRESHOLD = 15; // 15 minutes before considering as delayed
  private readonly REASSIGNMENT_THRESHOLD = 120; // 120 minutes before considering reassignment
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();

  async startMonitoring(deliveryId: string) {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          order: {
            include: { customer: true }
          },
          agent: true
        }
      });

      if (!delivery) {
        throw new Error(`Delivery ${deliveryId} not found`);
      }

      // Start monitoring interval
      const interval = setInterval(
        () => this.checkDeliveryProgress(deliveryId),
        5 * 60 * 1000 // Check every 5 minutes
      );

      this.monitoringIntervals.set(deliveryId, interval);

      // Log monitoring start
      await prisma.aIInteraction.create({
        data: {
          type: 'delivery_monitoring',
          content: `Started monitoring delivery ${deliveryId}`,
          metadata: {
            deliveryId,
            startTime: new Date()
          }
        }
      });
    } catch (error) {
      console.error('Error starting delivery monitoring:', error);
      throw error;
    }
  }

  async stopMonitoring(deliveryId: string) {
    const interval = this.monitoringIntervals.get(deliveryId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(deliveryId);
    }
  }

  async updateLocation(deliveryId: string, location: Location) {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          order: {
            include: { customer: true }
          }
        }
      });

      if (!delivery) {
        throw new Error(`Delivery ${deliveryId} not found`);
      }

      // Update delivery location and ETA
      const eta = await this.calculateETA(location, delivery.order.deliveryLocation as Location);
      await prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          currentLocation: location,
          lastLocationUpdate: new Date(),
          estimatedArrival: eta
        }
      });

      // Check if we need to notify the customer of updated ETA
      const delayMinutes = this.calculateDelay(delivery.scheduledTime, eta);
      if (delayMinutes > this.DELAY_THRESHOLD) {
        await this.handleDelay(delivery, delayMinutes);
      }
    } catch (error) {
      console.error('Error updating delivery location:', error);
      throw error;
    }
  }

  private async checkDeliveryProgress(deliveryId: string) {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          order: {
            include: { customer: true }
          },
          agent: true
        }
      });

      if (!delivery || delivery.status === DeliveryStatus.COMPLETED) {
        this.stopMonitoring(deliveryId);
        return;
      }

      // Calculate current delay
      const delayMinutes = this.calculateDelay(
        delivery.scheduledTime,
        delivery.estimatedArrival || new Date()
      );

      // Handle delay if necessary
      if (delayMinutes > this.DELAY_THRESHOLD) {
        await this.handleDelay(delivery, delayMinutes);
      }

      // Consider reassignment if delay is excessive
      if (delayMinutes > this.REASSIGNMENT_THRESHOLD && !delivery.humanIntervention) {
        await this.initiateReassignment(delivery);
      }
    } catch (error) {
      console.error('Error checking delivery progress:', error);
    }
  }

  private async handleDelay(delivery: Delivery, delayMinutes: number) {
    try {
      if (!delivery.delayNotified) {
        // Notify customer
        await communicationService.sendMessage(
          delivery.order.platform,
          delivery.order.customer.phone!,
          `Your delivery for order #${delivery.order.orderNumber} is experiencing a ${delayMinutes} minute delay. We are working to expedite your delivery.`
        );

        // Notify agent
        await communicationService.sendMessage(
          delivery.agent.preferredPlatform || 'WHATSAPP',
          delivery.agent.phone!,
          `You are currently ${delayMinutes} minutes behind schedule for order #${delivery.order.orderNumber}. Please update your status or contact support if you need assistance.`
        );

        // Trigger human intervention
        await this.triggerHumanIntervention(delivery, delayMinutes);

        // Update delivery status
        await prisma.delivery.update({
          where: { id: delivery.id },
          data: {
            delayMinutes,
            delayNotified: true,
            humanIntervention: true
          }
        });
      }
    } catch (error) {
      console.error('Error handling delivery delay:', error);
      throw error;
    }
  }

  private async triggerHumanIntervention(delivery: Delivery, delayMinutes: number) {
    try {
      // Notify admin via multiple channels
      const adminMessage = `⚠️ URGENT: Delivery Delay Alert\n` +
        `Order #${delivery.order.orderNumber} is ${delayMinutes} minutes delayed\n` +
        `Customer: ${delivery.order.customer.name} (${delivery.order.customer.phone})\n` +
        `Agent: ${delivery.agent.name} (${delivery.agent.phone})\n` +
        `Current Location: ${JSON.stringify(delivery.currentLocation)}\n` +
        `Scheduled Time: ${delivery.scheduledTime}\n` +
        `Estimated Arrival: ${delivery.estimatedArrival || 'Unknown'}`;

      // Send to admin via WhatsApp
      await communicationService.sendMessage(
        'WHATSAPP',
        process.env.ADMIN_WHATSAPP!,
        adminMessage
      );

      // Send to admin via Telegram
      await communicationService.sendMessage(
        'TELEGRAM',
        process.env.ADMIN_TELEGRAM!,
        adminMessage
      );

      // Send email to admin
      await communicationService.sendMessage(
        'EMAIL',
        process.env.ADMIN_EMAIL!,
        adminMessage
      );

      // Log human intervention
      await prisma.aIInteraction.create({
        data: {
          type: 'human_intervention',
          content: `Triggered human intervention for delivery ${delivery.id}`,
          metadata: {
            deliveryId: delivery.id,
            delayMinutes,
            currentLocation: delivery.currentLocation
          }
        }
      });
    } catch (error) {
      console.error('Error triggering human intervention:', error);
      throw error;
    }
  }

  private async initiateReassignment(delivery: Delivery) {
    try {
      // Update delivery status
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: DeliveryStatus.FAILED,
          notes: `Reassigned due to excessive delay of ${this.calculateDelay(
            delivery.scheduledTime,
            delivery.estimatedArrival || new Date()
          )} minutes`
        }
      });

      // Notify current agent
      await communicationService.sendMessage(
        delivery.agent.preferredPlatform || 'WHATSAPP',
        delivery.agent.phone!,
        `Due to excessive delay, order #${delivery.order.orderNumber} has been reassigned to another agent.`
      );

      // Attempt to reassign to a new agent
      await deliveryAssignmentService.assignDeliveryAgent(delivery.orderId);

      // Log reassignment
      await prisma.aIInteraction.create({
        data: {
          type: 'delivery_reassignment',
          content: `Reassigned delivery ${delivery.id} due to excessive delay`,
          metadata: {
            deliveryId: delivery.id,
            originalAgentId: delivery.agentId
          }
        }
      });
    } catch (error) {
      console.error('Error initiating delivery reassignment:', error);
      throw error;
    }
  }

  private calculateDelay(scheduledTime: Date, estimatedArrival: Date): number {
    return Math.max(
      0,
      Math.floor(
        (estimatedArrival.getTime() - scheduledTime.getTime()) / (1000 * 60)
      )
    );
  }

  private async calculateETA(
    currentLocation: Location,
    deliveryLocation: Location
  ): Promise<Date> {
    // TODO: Implement actual ETA calculation using mapping service
    // For now, using a simple estimation
    const distance = this.calculateDistance(currentLocation, deliveryLocation);
    const averageSpeed = 30; // km/h
    const estimatedTimeHours = distance / averageSpeed;
    
    const eta = new Date();
    eta.setHours(eta.getHours() + estimatedTimeHours);
    return eta;
  }

  private calculateDistance(point1: Location, point2: Location): number {
    // TODO: Implement actual distance calculation using mapping service
    // For now, using a simple estimation
    const R = 6371; // Earth's radius in km
    const dLat = this.deg2rad(point2.latitude - point1.latitude);
    const dLon = this.deg2rad(point2.longitude - point1.longitude);
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(point1.latitude)) * Math.cos(this.deg2rad(point2.latitude)) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI/180);
  }
}

export const deliveryMonitoringService = new DeliveryMonitoringService(); 