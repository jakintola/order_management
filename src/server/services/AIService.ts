import { config } from '../config';
import { logger } from '../logger';
import type { PrismaClient } from '@prisma/client';
import type { NlpManager } from 'node-nlp';

const prisma = new PrismaClient();

class AIService {
  private nlpManager: NlpManager | null = null;
  private fraudModel: any = null;
  private demoResponses: { [key: string]: string } = {
    'order.create': 'I\'ll help you place your order. Could you please provide:\n' +
      '1. Your name\n' +
      '2. Delivery address\n' +
      '3. Contact number\n' +
      '4. Order details\n' +
      '5. Preferred delivery time (optional)\n' +
      '6. Any special instructions?',
    'order.cancel': 'I understand you want to cancel your order. Could you please provide your order number?',
    'order.track': 'I can help you track your order. Please provide your order number.',
    'delivery.reschedule': 'I can help you reschedule your delivery. What time would work better for you?',
    'delivery.time': 'Let me check the estimated delivery time for your order. Could you share your order number?',
    'order.update.address': 'I can help you update your delivery address. Please provide your order number and new address.',
    'order.special.instructions': 'I\'ll note down your special delivery instructions. What would you like us to know?',
    'order.payment.methods': 'We accept various payment methods including credit/debit cards, digital wallets, and cash on delivery.',
    'order.payment.cash': 'Yes, we accept cash payments on delivery.',
    'order.payment.online': 'Yes, you can pay online using our secure payment gateway.',
    'default': 'I\'m here to help! How can I assist you today?'
  };

  constructor() {
    if (!config.DEMO_MODE && config.ENABLE_AI) {
      this.initializeAI();
    } else {
      logger.info('Running in demo mode or AI disabled - using mock AI responses');
    }
  }

  private async initializeAI() {
    try {
      // Initialize NLP
      const { NlpManager } = await import('node-nlp');
      this.nlpManager = new NlpManager({ languages: ['en'] });
      await this.initializeNLP();

      // Initialize OpenAI
      const { default: OpenAI } = await import('openai');
      const openai = new OpenAI({
        apiKey: config.OPENAI_API_KEY,
      });

      // Load fraud detection model
      const tf = await import('@tensorflow/tfjs-node');
      await this.loadFraudModel();

      logger.info('AI services initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize AI services:', error);
      this.nlpManager = null;
      this.fraudModel = null;
    }
  }

  async processMessage(message: string, platform: string): Promise<{
    intent: string;
    response: string;
    confidence: number;
  }> {
    if (config.DEMO_MODE || !config.ENABLE_AI) {
      // Simple keyword matching for demo mode
      const intent = this.getDemoIntent(message);
      return {
        intent,
        response: this.demoResponses[intent] || this.demoResponses.default,
        confidence: 0.8
      };
    }

    try {
      if (!this.nlpManager) {
        throw new Error('NLP manager not initialized');
      }

      const result = await this.nlpManager.process('en', message);
      const response = await this.generateAIResponse(message, result.intent);

      return {
        intent: result.intent || 'unknown',
        response,
        confidence: result.score || 0
      };
    } catch (error) {
      logger.error('Error processing message:', error);
      return {
        intent: 'error',
        response: 'I apologize, but I\'m having trouble understanding. Could you please rephrase that?',
        confidence: 0
      };
    }
  }

  private getDemoIntent(message: string): string {
    const messageLC = message.toLowerCase();
    if (messageLC.includes('place') && messageLC.includes('order')) return 'order.create';
    if (messageLC.includes('cancel')) return 'order.cancel';
    if (messageLC.includes('track') || messageLC.includes('where')) return 'order.track';
    if (messageLC.includes('reschedule')) return 'delivery.reschedule';
    if (messageLC.includes('delivery time') || messageLC.includes('arrive')) return 'delivery.time';
    if (messageLC.includes('address')) return 'order.update.address';
    if (messageLC.includes('instruction')) return 'order.special.instructions';
    if (messageLC.includes('payment method')) return 'order.payment.methods';
    if (messageLC.includes('cash')) return 'order.payment.cash';
    if (messageLC.includes('pay online')) return 'order.payment.online';
    return 'default';
  }

  async assessFraudRisk(order: any): Promise<number> {
    if (config.DEMO_MODE || !config.ENABLE_AI) {
      // Return low risk score in demo mode
      logger.info('[DEMO] Assessing fraud risk for order:', order);
      return 0.1;
    }

    // ... rest of the method implementation
  }

  async extractOrderDetails(message: string): Promise<{
    customerName?: string;
    phone?: string;
    address?: string;
    orderDetails?: string;
    preferredTime?: string;
    specialInstructions?: string;
  }> {
    if (config.DEMO_MODE || !config.ENABLE_AI) {
      // Return mock extracted details in demo mode
      logger.info('[DEMO] Extracting order details from message:', message);
      return {
        customerName: 'Demo User',
        phone: '+1234567890',
        address: '123 Demo Street, Demo City',
        orderDetails: 'Sample Order',
        preferredTime: '2:00 PM',
        specialInstructions: 'Demo instructions'
      };
    }

    // ... rest of the method implementation
  }

  // ... rest of the class implementation
}

export const aiService = new AIService(); 