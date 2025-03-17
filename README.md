# Order Management System

A comprehensive order management and delivery tracking system with AI-powered features, built with Node.js, React, and PostgreSQL.

## Features

- **Order Management**: Track and manage orders from creation to delivery
- **AI-Powered Assistance**: Natural language processing for customer support
- **Fraud Detection**: Intelligent risk assessment for orders
- **Multi-Channel Communication**: Integration with email, SMS, and messaging platforms
- **Real-Time Tracking**: Live updates on order status and delivery progress
- **Analytics Dashboard**: Visualize performance metrics and business intelligence

## Technology Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Caching**: Redis
- **AI/ML**: OpenAI integration, NLP for intent recognition
- **Communication**: Email (SMTP), Twilio (SMS), Telegram, Meta Webhooks
- **Containerization**: Docker and Docker Compose
- **Development**: ESLint, TypeScript, Git

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js (v20+) and pnpm (v8+) for local development

### Running with Docker

1. Clone the repository
   ```bash
   git clone https://github.com/jakintola/order_management.git
   cd order_management
   ```

2. Create a `.env` file based on `.env.example`
   ```bash
   cp .env.example .env
   ```

3. Start the services
   ```bash
   docker-compose up -d
   ```

4. Access the application at [http://localhost:3000](http://localhost:3000)
   - Admin panel: [http://localhost:5555](http://localhost:5555) (Prisma Studio)
   - Email testing: [http://localhost:8025](http://localhost:8025) (MailHog)
   - Database admin: [http://localhost:8080](http://localhost:8080) (Adminer)

### Demo Mode

The application supports a demo mode which simulates external services without requiring real API keys or credentials. To enable demo mode:

1. Set `DEMO_MODE=true` in your `.env` file
2. Set `ENABLE_AI=false`, `ENABLE_NOTIFICATIONS=false` to use mocked services

In demo mode:
- AI responses are simulated based on keywords
- External API calls are mocked with realistic dummy data
- Order processing follows the same workflow but no actual external calls are made
- Sample data is provided to demonstrate functionality

## Development

### Local Setup

1. Install dependencies
   ```bash
   pnpm install
   ```

2. Generate Prisma client
   ```bash
   pnpm prisma:generate
   ```

3. Start development servers
   ```bash
   pnpm dev
   ```

### Project Structure

- `/src/client` - React frontend application
- `/src/server` - Express backend server
- `/src/server/services` - Core business logic services
- `/prisma` - Database schema and migrations
- `/docker` - Docker configurations and helper scripts

## Contributors

- [Your Name](https://github.com/jakintola)

## License

This project is licensed under the MIT License - see the LICENSE file for details. 