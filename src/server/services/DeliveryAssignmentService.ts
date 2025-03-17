import { PrismaClient, Order, User, OrderStatus, DeliveryStatus } from '@prisma/client';
import { communicationService } from './CommunicationService';

const prisma = new PrismaClient();

interface AgentScore {
  agentId: string;
  score: number;
  distance: number;
  workload: number;
  successRate: number;
}

class DeliveryAssignmentService {
  private readonly ASSIGNMENT_TIMEOUT = 15 * 60 * 1000; // 15 minutes
  private assignmentTimers: Map<string, NodeJS.Timeout> = new Map();

  async assignDeliveryAgent(orderId: string) {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          customer: true,
        },
      });

      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }

      // Get available agents and their scores
      const availableAgents = await this.findAvailableAgents();
      if (availableAgents.length === 0) {
        throw new Error('No delivery agents available');
      }

      // Calculate scores for each agent
      const agentScores = await Promise.all(
        availableAgents.map(agent => this.calculateAgentScore(agent, order))
      );

      // Sort agents by score (highest first)
      const sortedAgents = agentScores.sort((a, b) => b.score - a.score);

      // Attempt to assign to the best agent
      await this.attemptAssignment(order, sortedAgents);

    } catch (error) {
      console.error('Error assigning delivery agent:', error);
      throw error;
    }
  }

  private async findAvailableAgents(): Promise<User[]> {
    return prisma.user.findMany({
      where: {
        role: 'DELIVERY_AGENT',
        // Add any additional availability criteria
        // e.g., not on break, within working hours, etc.
      },
      include: {
        deliveries: {
          where: {
            status: {
              in: ['ASSIGNED', 'IN_PROGRESS']
            }
          }
        }
      }
    });
  }

  private async calculateAgentScore(agent: User, order: Order): Promise<AgentScore> {
    // Calculate distance from agent to delivery location
    const distance = await this.calculateDistance(
      agent.lastKnownLocation,
      order.deliveryAddress
    );

    // Calculate current workload
    const workload = agent.deliveries.length;

    // Calculate success rate
    const successRate = await this.calculateSuccessRate(agent.id);

    // Calculate final score based on multiple factors
    const score = this.computeFinalScore(distance, workload, successRate);

    return {
      agentId: agent.id,
      score,
      distance,
      workload,
      successRate
    };
  }

  private async calculateDistance(agentLocation: any, deliveryAddress: string): Promise<number> {
    try {
      // Implement actual distance calculation using mapping service
      // This is a placeholder implementation
      return 1; // Normalized distance score (0-1)
    } catch (error) {
      console.error('Error calculating distance:', error);
      return 0.5; // Default to medium distance if calculation fails
    }
  }

  private async calculateSuccessRate(agentId: string): Promise<number> {
    const deliveryHistory = await prisma.delivery.findMany({
      where: {
        agentId,
        status: {
          in: ['COMPLETED', 'FAILED']
        }
      }
    });

    if (deliveryHistory.length === 0) return 0.5; // Default for new agents

    const successfulDeliveries = deliveryHistory.filter(
      d => d.status === 'COMPLETED'
    ).length;

    return successfulDeliveries / deliveryHistory.length;
  }

  private computeFinalScore(
    distance: number,
    workload: number,
    successRate: number
  ): number {
    // Weight factors based on importance
    const weights = {
      distance: 0.4,    // 40% weight for distance
      workload: 0.3,    // 30% weight for current workload
      successRate: 0.3  // 30% weight for success rate
    };

    // Normalize workload (0-1 scale, lower is better)
    const normalizedWorkload = Math.max(0, 1 - workload / 10);

    return (
      weights.distance * (1 - distance) +     // Distance score (closer is better)
      weights.workload * normalizedWorkload + // Workload score
      weights.successRate * successRate       // Success rate score
    );
  }

  private async attemptAssignment(order: Order, sortedAgents: AgentScore[]) {
    for (const agentScore of sortedAgents) {
      try {
        // Create delivery assignment
        const delivery = await prisma.delivery.create({
          data: {
            orderId: order.id,
            agentId: agentScore.agentId,
            status: DeliveryStatus.ASSIGNED,
            scheduledTime: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes from now
          },
          include: {
            agent: true,
          },
        });

        // Notify agent
        await this.notifyAgent(delivery);

        // Set confirmation timeout
        this.setAssignmentTimer(delivery);

        // Log assignment
        await prisma.aIInteraction.create({
          data: {
            type: 'delivery_assignment',
            content: `Order ${order.orderNumber} assigned to agent ${delivery.agent.name}`,
            metadata: {
              orderId: order.id,
              agentId: agentScore.agentId,
              agentScore: agentScore,
            },
          },
        });

        return delivery;
      } catch (error) {
        console.error(`Failed to assign to agent ${agentScore.agentId}:`, error);
        continue; // Try next agent
      }
    }

    throw new Error('Failed to assign order to any available agent');
  }

  private async notifyAgent(delivery: any) {
    const message = `New delivery assignment:\n` +
      `Order #${delivery.order.orderNumber}\n` +
      `Pickup: [Warehouse Location]\n` +
      `Delivery: ${delivery.order.deliveryAddress}\n` +
      `Scheduled Time: ${delivery.scheduledTime}\n\n` +
      `Reply with 'ACCEPT' to confirm this assignment.`;

    await communicationService.sendMessage(
      delivery.agent.preferredPlatform || 'WHATSAPP',
      delivery.agent.phone,
      message
    );
  }

  private setAssignmentTimer(delivery: any) {
    const timer = setTimeout(async () => {
      await this.handleUnconfirmedAssignment(delivery);
    }, this.ASSIGNMENT_TIMEOUT);

    this.assignmentTimers.set(delivery.id, timer);
  }

  private async handleUnconfirmedAssignment(delivery: any) {
    try {
      // Check if assignment is still pending
      const currentDelivery = await prisma.delivery.findUnique({
        where: { id: delivery.id },
        include: { order: true, agent: true },
      });

      if (!currentDelivery || currentDelivery.status !== 'ASSIGNED') {
        return; // Assignment already handled
      }

      // Cancel current assignment
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { status: DeliveryStatus.FAILED },
      });

      // Notify agent
      await communicationService.sendMessage(
        delivery.agent.preferredPlatform || 'WHATSAPP',
        delivery.agent.phone,
        `Assignment for Order #${delivery.order.orderNumber} has been cancelled due to no confirmation.`
      );

      // Try to reassign
      await this.assignDeliveryAgent(delivery.order.id);

    } catch (error) {
      console.error('Error handling unconfirmed assignment:', error);
      throw error;
    }
  }

  async handleAgentConfirmation(deliveryId: string, confirmed: boolean) {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: { order: true, agent: true },
      });

      if (!delivery) {
        throw new Error(`Delivery ${deliveryId} not found`);
      }

      if (confirmed) {
        // Update delivery and order status
        await prisma.$transaction([
          prisma.delivery.update({
            where: { id: deliveryId },
            data: { status: DeliveryStatus.IN_PROGRESS },
          }),
          prisma.order.update({
            where: { id: delivery.orderId },
            data: { status: OrderStatus.IN_DELIVERY },
          }),
        ]);

        // Clear assignment timer
        this.clearAssignmentTimer(deliveryId);

        // Notify customer
        await communicationService.sendMessage(
          delivery.order.platform,
          delivery.order.customer.phone!,
          `Your order #${delivery.order.orderNumber} is now out for delivery with ${delivery.agent.name}.`
        );

        return true;
      } else {
        // Handle rejection - try to find another agent
        await this.handleUnconfirmedAssignment(delivery);
        return false;
      }
    } catch (error) {
      console.error('Error handling agent confirmation:', error);
      throw error;
    }
  }

  private clearAssignmentTimer(deliveryId: string) {
    const timer = this.assignmentTimers.get(deliveryId);
    if (timer) {
      clearTimeout(timer);
      this.assignmentTimers.delete(deliveryId);
    }
  }
}

export const deliveryAssignmentService = new DeliveryAssignmentService(); 