# AI Sales Operator

B2B SaaS platform for e-commerce customer support automation using AI.

## Features

- Telegram Personal integration via gramjs with QR authentication
- Multi-tenant architecture
- Subscription-based access (50 USDT/month via CryptoBot)
- 3-day free trial
- Session persistence
- Two-way messaging
- AI message processing with OpenAI GPT

## Environment Variables

Copy `.env.example` to `.env` and configure all required values.

## Deployment

Use PM2 for production:

pm2 start ecosystem.config.cjs
