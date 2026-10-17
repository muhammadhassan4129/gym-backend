import 'dotenv/config';

import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';

import apiRoutes from './routes/apiRoutes.js';
import authRoutes from './routes/authRoutes.js';

import {
  Expense,
  Member,
  Payment,
  Service,
  Subscription,
} from './models/index.js';

import { syncInvoices } from './services/billingService.js';
import { errorHandler } from './utils/helpers.js';

const app = express();

app.disable('x-powered-by');

// Fully open CORS to prevent any frontend origin errors on deployment or local
app.use(
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  })
);

app.use(express.json({ limit: '1mb' }));

// Database connection handler for serverless & local
let isConnected = false;

async function connectDB() {
  if (isConnected || mongoose.connection.readyState === 1) {
    return;
  }
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required in .env');
  }

  await mongoose.connect(process.env.MONGO_URI, {
    autoIndex: false,
  });

  isConnected = true;
  console.log('MongoDB connected successfully');
  console.log(`Database: ${mongoose.connection.name}`);
}

// Middleware to ensure DB connection on every request in serverless environments
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    next(error);
  }
});

// Health check
app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;

  res.status(connected ? 200 : 503).json({
    status: connected ? 'ok' : 'unavailable',
    database: connected ? 'connected' : 'disconnected',
  });
});

// API routes
app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);

// Not found
app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found',
  });
});

// Error handler
app.use(errorHandler);

// For Local Development & Standalone Server
if (process.env.NODE_ENV !== 'production') {
  const port = Number(process.env.PORT || 5000);

  connectDB().then(async () => {
    try {
      // Required indexes check
      for (const model of [
        Member,
        Service,
        Subscription,
        Payment,
        Expense,
      ]) {
        await model.createIndexes();
      }
      console.log('Database indexes ready');

      await syncInvoices();
      console.log('Initial billing sync completed');
    } catch (err) {
      console.error('Initialization error:', err.message);
    }

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  });
}

// Export app for Vercel Serverless Deployment
export default app;