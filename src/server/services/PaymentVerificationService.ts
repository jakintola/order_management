import { PrismaClient, Delivery, User, DeliveryStatus } from '@prisma/client';
import { communicationService } from './CommunicationService';
import { aiService } from './AIService';

const prisma = new PrismaClient();

interface FraudFlag {
  type: string;
  description: string;
  severity: number;
  evidence: any;
}

class PaymentVerificationService {
  private readonly FRAUD_SCORE_THRESHOLD = 0.7;
  private readonly RESTRICTION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

  async recordCashCollection(deliveryId: string, amount: number) {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          order: true,
          agent: true,
        },
      });

      if (!delivery) {
        throw new Error(`Delivery ${deliveryId} not found`);
      }

      // Verify amount matches order total
      if (amount !== delivery.order.totalAmount) {
        await this.flagDiscrepancy(delivery, amount, 'collection');
      }

      // Update delivery record
      await prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          cashCollected: amount,
          status: DeliveryStatus.DELIVERED_UNPAID,
        },
      });

      // Update agent's collection history
      await prisma.user.update({
        where: { id: delivery.agentId },
        data: {
          totalCollections: {
            increment: amount,
          },
        },
      });

      // Log the collection
      await prisma.aIInteraction.create({
        data: {
          type: 'cash_collection',
          content: `Cash collected for delivery ${deliveryId}`,
          metadata: {
            deliveryId,
            amount,
            expectedAmount: delivery.order.totalAmount,
          },
        },
      });
    } catch (error) {
      console.error('Error recording cash collection:', error);
      throw error;
    }
  }

  async recordCashRemittance(deliveryId: string, amount: number, proofUrl?: string) {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          order: true,
          agent: true,
        },
      });

      if (!delivery) {
        throw new Error(`Delivery ${deliveryId} not found`);
      }

      // Check for discrepancies
      if (amount !== delivery.cashCollected) {
        await this.flagDiscrepancy(delivery, amount, 'remittance');
      }

      // Update delivery record
      await prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          cashRemitted: amount,
          remittanceTime: new Date(),
          remittanceProof: proofUrl,
          status: DeliveryStatus.DELIVERED_PAID,
        },
      });

      // Update agent's remittance history
      await prisma.user.update({
        where: { id: delivery.agentId },
        data: {
          totalRemittances: {
            increment: amount,
          },
        },
      });

      // Verify remittance
      await this.verifyRemittance(deliveryId);
    } catch (error) {
      console.error('Error recording cash remittance:', error);
      throw error;
    }
  }

  private async verifyRemittance(deliveryId: string) {
    try {
      const delivery = await prisma.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          order: true,
          agent: true,
        },
      });

      if (!delivery) {
        throw new Error(`Delivery ${deliveryId} not found`);
      }

      const fraudScore = await this.calculateFraudScore(delivery);
      const fraudFlags = await this.detectFraudPatterns(delivery);

      // Update delivery with fraud assessment
      await prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          fraudScore,
          fraudFlags: fraudFlags.length > 0 ? fraudFlags : undefined,
          remittanceVerified: fraudScore < this.FRAUD_SCORE_THRESHOLD,
        },
      });

      // Handle high fraud scores
      if (fraudScore >= this.FRAUD_SCORE_THRESHOLD) {
        await this.handleFraudSuspicion(delivery, fraudFlags);
      } else {
        // Update remittance rating for agent
        await this.updateAgentRating(delivery.agent);
      }
    } catch (error) {
      console.error('Error verifying remittance:', error);
      throw error;
    }
  }

  private async calculateFraudScore(delivery: Delivery & { agent: User }): Promise<number> {
    const weights = {
      amountDiscrepancy: 0.3,
      remittanceDelay: 0.2,
      historicalRating: 0.3,
      fraudHistory: 0.2,
    };

    // Calculate individual scores
    const amountDiscrepancy = Math.abs((delivery.cashCollected || 0) - (delivery.cashRemitted || 0)) / (delivery.cashCollected || 1);
    const remittanceDelay = delivery.remittanceTime ? 
      Math.min(1, (delivery.remittanceTime.getTime() - delivery.completedTime!.getTime()) / (24 * 60 * 60 * 1000)) : 1;
    const historicalRating = 1 - (delivery.agent.remittanceRating || 0);
    const fraudHistory = Math.min(1, delivery.agent.fraudIncidents / 5);

    // Calculate weighted score
    return (
      weights.amountDiscrepancy * amountDiscrepancy +
      weights.remittanceDelay * remittanceDelay +
      weights.historicalRating * historicalRating +
      weights.fraudHistory * fraudHistory
    );
  }

  private async detectFraudPatterns(delivery: Delivery): Promise<FraudFlag[]> {
    const fraudFlags: FraudFlag[] = [];

    // Check for amount discrepancy
    if (delivery.cashCollected !== delivery.cashRemitted) {
      fraudFlags.push({
        type: 'amount_discrepancy',
        description: 'Remitted amount does not match collected amount',
        severity: 0.8,
        evidence: {
          collected: delivery.cashCollected,
          remitted: delivery.cashRemitted,
        },
      });
    }

    // Check for delayed remittance
    if (delivery.remittanceTime && delivery.completedTime) {
      const delayHours = (delivery.remittanceTime.getTime() - delivery.completedTime.getTime()) / (60 * 60 * 1000);
      if (delayHours > 24) {
        fraudFlags.push({
          type: 'delayed_remittance',
          description: 'Remittance delayed by more than 24 hours',
          severity: 0.5,
          evidence: {
            delayHours,
            completedTime: delivery.completedTime,
            remittanceTime: delivery.remittanceTime,
          },
        });
      }
    }

    return fraudFlags;
  }

  private async handleFraudSuspicion(delivery: Delivery, fraudFlags: FraudFlag[]) {
    try {
      // Restrict agent
      const restrictionEnd = new Date(Date.now() + this.RESTRICTION_DURATION);
      await prisma.user.update({
        where: { id: delivery.agentId },
        data: {
          isRestricted: true,
          fraudIncidents: {
            increment: 1,
          },
        },
      });

      // Update delivery status
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: {
          status: DeliveryStatus.PAYMENT_DISPUTED,
          restrictedUntil: restrictionEnd,
        },
      });

      // Notify finance team
      const fraudAlert = `🚨 FRAUD ALERT: Suspicious Remittance\n` +
        `Delivery ID: ${delivery.id}\n` +
        `Order Number: ${delivery.order.orderNumber}\n` +
        `Agent: ${delivery.agent.name}\n` +
        `Fraud Score: ${delivery.fraudScore}\n\n` +
        `Fraud Flags:\n${fraudFlags.map(flag => 
          `- ${flag.type}: ${flag.description} (Severity: ${flag.severity})`
        ).join('\n')}`;

      await communicationService.sendMessage(
        'EMAIL',
        process.env.FINANCE_TEAM_EMAIL!,
        fraudAlert
      );

      // Log the fraud incident
      await prisma.aIInteraction.create({
        data: {
          type: 'fraud_alert',
          content: fraudAlert,
          metadata: {
            deliveryId: delivery.id,
            fraudScore: delivery.fraudScore,
            fraudFlags,
          },
        },
      });
    } catch (error) {
      console.error('Error handling fraud suspicion:', error);
      throw error;
    }
  }

  private async updateAgentRating(agent: User) {
    try {
      const remittanceRating = agent.totalRemittances / agent.totalCollections;
      await prisma.user.update({
        where: { id: agent.id },
        data: {
          remittanceRating: Math.min(1, remittanceRating),
        },
      });
    } catch (error) {
      console.error('Error updating agent rating:', error);
      throw error;
    }
  }

  private async flagDiscrepancy(delivery: Delivery, amount: number, type: 'collection' | 'remittance') {
    const discrepancyAlert = `⚠️ Amount Discrepancy Alert\n` +
      `Delivery ID: ${delivery.id}\n` +
      `Order Number: ${delivery.order.orderNumber}\n` +
      `Agent: ${delivery.agent.name}\n` +
      `Type: ${type}\n` +
      `Expected: ${type === 'collection' ? delivery.order.totalAmount : delivery.cashCollected}\n` +
      `Actual: ${amount}`;

    await communicationService.sendMessage(
      'EMAIL',
      process.env.FINANCE_TEAM_EMAIL!,
      discrepancyAlert
    );

    await prisma.aIInteraction.create({
      data: {
        type: 'amount_discrepancy',
        content: discrepancyAlert,
        metadata: {
          deliveryId: delivery.id,
          type,
          expected: type === 'collection' ? delivery.order.totalAmount : delivery.cashCollected,
          actual: amount,
        },
      },
    });
  }
}

export const paymentVerificationService = new PaymentVerificationService(); 