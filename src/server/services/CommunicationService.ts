import { config } from '../config';
import { logger } from '../logger';
import type { Telegraf } from 'telegraf';
import type { Twilio } from 'twilio';
import type { Client } from 'whatsapp-web.js';
import axios from 'axios';
import { aiService } from './AIService';
import { PrismaClient } from '@prisma/client';
import type { Transporter } from 'nodemailer';

const prisma = new PrismaClient();

class CommunicationService {
  private telegramBot?: Telegraf;
  private twilioClient?: Twilio;
  private whatsappClient?: Client;
  private metaApiUrl = 'https://graph.facebook.com/v18.0';
  private emailTransporter?: Transporter;

  constructor() {
    if (config.DEMO_MODE || !config.ENABLE_NOTIFICATIONS) {
      logger.info('Running in demo mode or notifications disabled - external communication services will be mocked');
      return;
    }

    this.initializeAll();
  }

  private async initializeAll() {
    try {
      if (config.TELEGRAM_BOT_TOKEN) {
        const { Telegraf } = await import('telegraf');
        this.telegramBot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
        this.initializeTelegramBot();
      }

      if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN) {
        const twilio = await import('twilio');
        this.twilioClient = twilio.default(
          config.TWILIO_ACCOUNT_SID,
          config.TWILIO_AUTH_TOKEN
        );
      }

      if (config.ENABLE_NOTIFICATIONS) {
        const { Client } = await import('whatsapp-web.js');
        this.whatsappClient = new Client({});
        await this.initializeWhatsAppClient();
      }

      if (config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS) {
        const nodemailer = await import('nodemailer');
        this.emailTransporter = nodemailer.createTransport({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT || 587,
          secure: config.SMTP_SECURE,
          auth: {
            user: config.SMTP_USER,
            pass: config.SMTP_PASS,
          },
        });
      }

      this.initializeMetaWebhooks();
    } catch (error) {
      logger.error('Error initializing communication services:', error);
    }
  }

  private initializeTelegramBot() {
    if (!this.telegramBot || config.DEMO_MODE) return;
    this.telegramBot.on('text', async (ctx) => {
      try {
        const message = ctx.message.text;
        const response = await this.processIncomingMessage(message, 'TELEGRAM');
        await ctx.reply(response);
      } catch (error) {
        console.error('Error processing Telegram message:', error);
        await ctx.reply('Sorry, I encountered an error processing your message.');
      }
    });

    this.telegramBot.launch();
  }

  private async initializeWhatsAppClient() {
    if (!this.whatsappClient || config.DEMO_MODE) return;
    this.whatsappClient.on('qr', (qr) => {
      // Handle QR code generation for WhatsApp Web authentication
      console.log('WhatsApp QR Code:', qr);
    });

    this.whatsappClient.on('ready', () => {
      console.log('WhatsApp client is ready');
    });

    this.whatsappClient.on('message', async (message) => {
      try {
        const response = await this.processIncomingMessage(message.body, 'WHATSAPP');
        await message.reply(response);
      } catch (error) {
        console.error('Error processing WhatsApp message:', error);
      }
    });

    await this.whatsappClient.initialize();
  }

  private initializeMetaWebhooks() {
    if (config.DEMO_MODE) return;
    return {
      handleMessage: async (sender: string, message: string, platform: 'FACEBOOK' | 'INSTAGRAM') => {
        try {
          // Process the incoming message with AI
          const response = await this.processIncomingMessage(message, platform);

          // Send response back to the user
          await this.sendMetaMessage(platform, sender, response);

          // Log the interaction
          await prisma.aIInteraction.create({
            data: {
              type: 'meta_message',
              content: message,
              metadata: {
                platform,
                sender,
                response
              }
            }
          });
        } catch (error) {
          console.error(`Error handling ${platform} message:`, error);
          throw error;
        }
      },

      verifyWebhook: (mode: string, token: string, challenge: string): string | null => {
        if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
          return challenge;
        }
        return null;
      }
    };
  }

  private async initializeLeadFormWebhooks() {
    return {
      handleLeadSubmission: async (formData: {
        formId: string,
        pageId: string,
        platform: 'FACEBOOK' | 'INSTAGRAM',
        leadData: {
          name: string,
          email: string,
          phone: string,
          address?: string,
          message?: string,
          customFields?: Record<string, string>
        }
      }) => {
        try {
          // Format the lead data into an order inquiry
          const orderInquiry = {
            platform: formData.platform,
            formId: formData.formId,
            leadData: {
              name: formData.leadData.name,
              phone: formData.leadData.phone,
              email: formData.leadData.email,
              address: formData.leadData.address || '',
              orderDetails: formData.leadData.message || '',
              preferredDeliveryTime: formData.leadData.customFields?.preferredTime,
              specialInstructions: formData.leadData.customFields?.specialInstructions
            }
          };

          // Process the lead
          const response = await this.handleLeadFormSubmission(orderInquiry);

          // Notify admin/sales team
          await this.emailTransporter?.sendMail({
            from: process.env.SMTP_FROM_ADDRESS,
            to: process.env.LEAD_FORM_NOTIFICATION_EMAIL,
            subject: `New Lead Form Submission - ${formData.platform}`,
            text: `
New lead form submission received:
Platform: ${formData.platform}
Form ID: ${formData.formId}
Name: ${formData.leadData.name}
Email: ${formData.leadData.email}
Phone: ${formData.leadData.phone}
Address: ${formData.leadData.address || 'Not provided'}
Message: ${formData.leadData.message || 'Not provided'}
${Object.entries(formData.leadData.customFields || {})
  .map(([key, value]) => `${key}: ${value}`)
  .join('\n')}
            `
          });

          return response;
        } catch (error) {
          console.error('Error handling lead form submission:', error);
          throw error;
        }
      }
    };
  }

  async sendMessage(platform: string, recipient: string, message: string): Promise<void> {
    if (config.DEMO_MODE) {
      logger.info(`[DEMO] Would send message to ${recipient} via ${platform}: ${message}`);
      return;
    }

    try {
      switch (platform.toLowerCase()) {
        case 'telegram':
          if (this.telegramBot) {
            await this.telegramBot.telegram.sendMessage(recipient, message);
          }
          break;
        case 'sms':
          if (this.twilioClient && config.TWILIO_PHONE_NUMBER) {
            await this.twilioClient.messages.create({
              body: message,
              from: config.TWILIO_PHONE_NUMBER,
              to: recipient,
            });
          }
          break;
        case 'whatsapp':
          if (this.whatsappClient) {
            await this.whatsappClient.sendMessage(recipient, message);
          }
          break;
        case 'facebook':
        case 'instagram':
          await this.sendMetaMessage(platform, recipient, message);
          break;
        case 'email':
          await this.sendEmailResponse(recipient, message);
          break;
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }

      // Log the outgoing message
      await prisma.aIInteraction.create({
        data: {
          type: 'outgoing_message',
          content: message,
          metadata: {
            platform,
            recipient,
          },
        },
      });
    } catch (error) {
      logger.error(`Error sending message via ${platform}:`, error);
      throw error;
    }
  }

  private async sendMetaMessage(platform: string, recipient: string, message: string): Promise<void> {
    try {
      const response = await axios.post(
        `${this.metaApiUrl}/me/messages`,
        {
          recipient: { id: recipient },
          message: { text: message },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
          },
        }
      );

      if (response.status !== 200) {
        throw new Error(`Failed to send Meta message: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error sending Meta message:', error);
      throw error;
    }
  }

  private async processIncomingMessage(message: string, platform: string): Promise<string> {
    try {
      const { response } = await aiService.processMessage(message, platform);
      return response;
    } catch (error) {
      console.error('Error processing incoming message:', error);
      return 'I apologize, but I encountered an error processing your message. Please try again later.';
    }
  }

  async notifyDeliveryDelay(delivery: any): Promise<void> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: delivery.orderId },
        include: { customer: true },
      });

      if (!order) {
        throw new Error(`Order not found for delivery ${delivery.id}`);
      }

      const message = `Dear ${order.customer.name}, your delivery (Order #${order.orderNumber}) is experiencing a delay. Our team has been notified and will contact you shortly with more information.`;

      // Send notification through the customer's preferred platform
      await this.sendMessage(order.platform, order.customer.phone!, message);
    } catch (error) {
      console.error('Error notifying delivery delay:', error);
      throw error;
    }
  }

  async handleLeadFormSubmission(data: {
    platform: 'FACEBOOK' | 'INSTAGRAM';
    formId: string;
    leadData: {
      name: string;
      phone: string;
      email: string;
      address: string;
      orderDetails: string;
      preferredDeliveryTime?: string;
      specialInstructions?: string;
    };
  }) {
    try {
      // Process lead form data
      const message = `New order inquiry from ${data.leadData.name}:\n` +
        `Order Details: ${data.leadData.orderDetails}\n` +
        `Delivery Time: ${data.leadData.preferredDeliveryTime || 'Not specified'}\n` +
        `Special Instructions: ${data.leadData.specialInstructions || 'None'}`;

      // Log the lead
      await prisma.aIInteraction.create({
        data: {
          type: 'lead_form_submission',
          content: message,
          metadata: {
            platform: data.platform,
            formId: data.formId,
            leadData: data.leadData,
          },
        },
      });

      // Process with AI for fraud detection and response
      const aiResponse = await this.processIncomingMessage(message, data.platform);

      // Send confirmation email
      await this.sendEmailConfirmation(data.leadData);

      return aiResponse;
    } catch (error) {
      console.error('Error handling lead form submission:', error);
      throw error;
    }
  }

  async handleEmailInquiry(data: {
    from: string;
    subject: string;
    body: string;
    attachments?: Array<{ filename: string; content: Buffer }>;
  }) {
    try {
      // Process email inquiry
      const message = `New email inquiry:\nFrom: ${data.from}\nSubject: ${data.subject}\nBody: ${data.body}`;

      // Log the email inquiry
      await prisma.aIInteraction.create({
        data: {
          type: 'email_inquiry',
          content: message,
          metadata: {
            from: data.from,
            subject: data.subject,
            hasAttachments: !!data.attachments?.length,
          },
        },
      });

      // Process with AI
      const aiResponse = await this.processIncomingMessage(message, 'EMAIL');

      // Send auto-response
      await this.sendEmailResponse(data.from, aiResponse);

      return aiResponse;
    } catch (error) {
      console.error('Error handling email inquiry:', error);
      throw error;
    }
  }

  private async sendEmailConfirmation(leadData: {
    name: string;
    email: string;
    orderDetails: string;
  }) {
    try {
      await this.emailTransporter?.sendMail({
        from: process.env.SMTP_FROM_ADDRESS,
        to: leadData.email,
        subject: 'Thank you for your order inquiry',
        text: `Dear ${leadData.name},\n\nThank you for your order inquiry. We have received your request and will process it shortly.\n\nOrder Details: ${leadData.orderDetails}\n\nBest regards,\nYour Order Management Team`,
      });
    } catch (error) {
      console.error('Error sending email confirmation:', error);
      throw error;
    }
  }

  private async sendEmailResponse(to: string, message: string) {
    try {
      await this.emailTransporter?.sendMail({
        from: process.env.SMTP_FROM_ADDRESS,
        to: to,
        subject: 'Re: Your Order Inquiry',
        text: message,
      });
    } catch (error) {
      console.error('Error sending email response:', error);
      throw error;
    }
  }
}

const weights = {
  distance: 0.4,    // 40% weight for distance
  workload: 0.3,    // 30% weight for current workload
  successRate: 0.3  // 30% weight for success rate
};

export const communicationService = new CommunicationService(); 