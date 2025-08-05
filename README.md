# Portal365 - Multi-Entity Gym Management Platform

A sophisticated gym management system with VAT-optimized payment routing across multiple business entities.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Docker & Docker Compose (for local development)
- PostgreSQL (production)

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/SalekhM8/portal365.git
   cd portal365
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start local PostgreSQL**
   ```bash
   docker-compose up -d postgres
   ```

4. **Setup database**
   ```bash
   npm run db:setup
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

## 🏗️ Production Deployment

### Vercel Deployment

1. **Create PostgreSQL database** in Vercel dashboard
2. **Set environment variables** in Vercel:
   ```
   DATABASE_URL="postgresql://..."
   NEXTAUTH_SECRET="your-production-secret"
   NEXTAUTH_URL="https://your-app.vercel.app"
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_..."
   STRIPE_SECRET_KEY="sk_live_..."
   ```

3. **Setup database schema**
   ```bash
   # Run once after deployment
   npx prisma db push
   npx prisma db seed
   ```

## 🛠️ Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run db:setup` - Setup database (generate + push + seed)
- `npm run db:push` - Push schema to database
- `npm run db:seed` - Seed database with initial data

## 🎯 Features

- ✅ Multi-entity VAT optimization
- ✅ Prorated billing (1st of month)
- ✅ Stripe subscription management
- ✅ Customer dashboard
- ✅ Admin analytics
- ✅ Automated payment routing

## 📊 Tech Stack

- **Framework**: Next.js 15
- **Database**: PostgreSQL + Prisma
- **Payments**: Stripe
- **Auth**: NextAuth.js
- **Styling**: Tailwind CSS
- **Deployment**: Vercel
