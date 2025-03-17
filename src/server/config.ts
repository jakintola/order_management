import { z } from 'zod';
import * as dotenv from 'dotenv';
import { logger } from './logger.js';

dotenv.config();

const configSchema = z.object({
  // Server settings
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // Database & Redis
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  
  // Security
  JWT_SECRET: z.string(),
  
  // Feature flags
  DEMO_MODE: z.string().transform(val => val === 'true').default('false'),
  ENABLE_AI: z.string().transform(val => val === 'true').default('false'),
  ENABLE_NOTIFICATIONS: z.string().transform(val => val === 'true').default('false'),
  ENABLE_WEBHOOKS: z.string().transform(val => val === 'true').default('false'),
  
  // Exchange settings (optional in demo mode)
  EXCHANGE_API_KEY: z.string().optional(),
  EXCHANGE_SECRET: z.string().optional(),
  
  // AI settings (optional in demo mode)
  OPENAI_API_KEY: z.string().optional(),
  AI_FRAUD_THRESHOLD: z.string().transform(Number).default('0.7'),
  AI_CONFIDENCE_THRESHOLD: z.string().transform(Number).default('0.85'),
  AI_RESPONSE_TIMEOUT: z.string().transform(Number).default('5000'),
  
  // Communication settings (optional in demo mode)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  
  // Email settings (optional in demo mode)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).optional(),
  SMTP_SECURE: z.string().transform(val => val === 'true').optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM_ADDRESS: z.string().optional(),
});

export const config = configSchema.parse(process.env);

// Add isDemoMode getter for convenience
export const isDemoMode = config.DEMO_MODE;

// Add configuration types
export type Config = z.infer<typeof configSchema>;