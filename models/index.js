import mongoose from 'mongoose';

const { Schema } = mongoose;

const moneyField = {
  type: Number,
  min: 0,
  required: true,
  validate: {
    validator: (value) =>
      Number.isFinite(value) &&
      Math.abs(value * 100 - Math.round(value * 100)) < 0.00001,
    message: 'Amount must have at most 2 decimal places',
  },
};

const memberSchema = new Schema(
  {
    memberId: {
      type: String,
      required: true,
      unique: true,
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
    },

    address: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },

    registrationDate: {
      type: Date,
      required: true,
      default: Date.now,
    },

    notes: {
      type: String,
      default: '',
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

const serviceSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 120,
    },

    fee: moneyField,

    description: {
      type: String,
      default: '',
      maxlength: 2000,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const subscriptionSchema = new Schema(
  {
    memberId: {
      type: Schema.Types.ObjectId,
      ref: 'Member',
      required: true,
    },

    serviceId: {
      type: Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    },

    // Contracted fee: service fee edits do not alter this value.
    fee: moneyField,

    billingMethod: {
      type: String,
      enum: ['calendar-month'],
      default: 'calendar-month',
      required: true,
    },

    startDate: {
      type: Date,
      required: true,
    },

    // Next period that still needs an invoice.
    nextBillingDate: {
      type: Date,
      required: true,
    },

    // Kept for compatibility with the old frontend.
    dueDate: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled'],
      default: 'active',
      required: true,
    },

    cancelledAt: Date,

    billingVersion: {
      type: Number,
      required: true,
      default: 2,
    },
  },
  { timestamps: true }
);

// Same member can have multiple different services,
// but cannot have two active subscriptions for one service.
subscriptionSchema.index(
  { memberId: 1, serviceId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
  }
);

subscriptionSchema.index({ status: 1, nextBillingDate: 1 });

const receiptSchema = new Schema(
  {
    receiptNumber: {
      type: String,
      required: true,
    },

    idempotencyKey: {
      type: String,
      required: true,
    },

    amount: moneyField,

    method: {
      type: String,
      enum: ['cash', 'bank', 'card', 'other'],
      required: true,
    },

    reference: {
      type: String,
      default: '',
      maxlength: 200,
    },

    note: {
      type: String,
      default: '',
      maxlength: 1000,
    },

    receivedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { _id: true }
);

const paymentSchema = new Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
    },

    memberId: {
      type: Schema.Types.ObjectId,
      ref: 'Member',
      required: true,
    },

    serviceId: {
      type: Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    },

    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
    },

    // Historical name, unaffected by future service renaming.
    serviceName: {
      type: String,
      default: '',
    },

    billingMonth: {
      type: String,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
    },

    billingPeriod: {
      type: String,
      required: true,
    },

    periodStart: Date,

    // Exclusive: next month's first day.
    periodEnd: Date,

    dueDate: Date,

    amountCharged: moneyField,

    amountPaid: {
      ...moneyField,
      default: 0,
    },

    remainingBalance: moneyField,

    status: {
      type: String,
      enum: ['paid', 'partial', 'unpaid'],
      default: 'unpaid',
      required: true,
    },

    paymentDate: Date,

    transactions: {
      type: [receiptSchema],
      default: [],
    },

    // Previously received money without installment dates.
    legacyPaidAmount: {
      ...moneyField,
      default: 0,
    },

    legacy: {
      type: Boolean,
      default: false,
    },

    billingVersion: {
      type: Number,
      required: true,
      default: 2,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

paymentSchema.index(
  { subscriptionId: 1, billingMonth: 1 },
  {
    unique: true,
    partialFilterExpression: {
      subscriptionId: { $type: 'objectId' },
      billingMonth: { $type: 'string' },
    },
  }
);

paymentSchema.index({ billingMonth: 1, status: 1 });
paymentSchema.index({ memberId: 1, createdAt: -1 });
paymentSchema.index({ 'transactions.receivedAt': 1 });

const expenseSchema = new Schema(
  {
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },

    category: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    amount: moneyField,

    description: {
      type: String,
      default: '',
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

expenseSchema.index({ date: -1 });

export const Member = mongoose.model('Member', memberSchema);
export const Service = mongoose.model('Service', serviceSchema);
export const Subscription = mongoose.model(
  'Subscription',
  subscriptionSchema
);
export const Payment = mongoose.model('Payment', paymentSchema);
export const Expense = mongoose.model('Expense', expenseSchema);