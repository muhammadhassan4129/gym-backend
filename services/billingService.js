import mongoose from 'mongoose';

import {
  Payment,
  Service,
  Subscription,
} from '../models/index.js';

import {
  addDays,
  currentMonth,
  localDate,
  monthStart,
  nextMonth,
} from '../utils/helpers.js';

function graceDays() {
  const value = Number(process.env.PAYMENT_GRACE_DAYS ?? 7);

  if (!Number.isInteger(value) || value < 0 || value > 31) {
    throw new Error('PAYMENT_GRACE_DAYS must be between 0 and 31');
  }

  return value;
}

// Must be called inside a MongoDB transaction.
export async function issueInvoice(subscription, session) {
  const start = new Date(subscription.nextBillingDate);

  const billingMonth = currentMonth(start);
  const end = monthStart(nextMonth(billingMonth));

  let invoice = await Payment.findOne({
    subscriptionId: subscription._id,
    billingMonth,
  }).session(session);

  if (!invoice) {
    const service = await Service.findById(
      subscription.serviceId
    ).session(session);

    if (!service) {
      throw new Error(
        `Service missing for subscription ${subscription._id}`
      );
    }

    const invoices = await Payment.create(
      [
        {
          invoiceNumber:
            `INV-${billingMonth.replace('-', '')}-` +
            subscription._id.toString().toUpperCase(),

          memberId: subscription.memberId,
          serviceId: subscription.serviceId,
          subscriptionId: subscription._id,

          serviceName: service.name,

          billingMonth,
          billingPeriod:
            `${localDate(start)} to ${localDate(addDays(end, -1))}`,

          periodStart: start,
          periodEnd: end,

          dueDate: addDays(start, graceDays()),

          amountCharged: subscription.fee,
          amountPaid: 0,
          remainingBalance: subscription.fee,

          status: subscription.fee === 0 ? 'paid' : 'unpaid',

          transactions: [],
          legacyPaidAmount: 0,
          legacy: false,
          billingVersion: 2,
        },
      ],
      { session }
    );

    invoice = invoices[0];
  }

  subscription.nextBillingDate = end;
  subscription.dueDate = end;

  await subscription.save({ session });

  return invoice;
}

async function syncSubscription(subscriptionId, asOf) {
  let processedPeriods = 0;

  while (true) {
    const processed = await mongoose.connection.transaction(
      async (session) => {
        const subscription = await Subscription.findOne({
          _id: subscriptionId,
          status: 'active',
          billingVersion: 2,
          nextBillingDate: { $lte: asOf },
        }).session(session);

        if (!subscription) {
          return false;
        }

        await issueInvoice(subscription, session);
        return true;
      }
    );

    if (!processed) break;

    processedPeriods += 1;
  }

  return processedPeriods;
}

let runningSync = null;

export function syncInvoices() {
  // Avoid overlapping work inside one Node process.
  // Database transactions and unique indexes also protect
  // against concurrent work from other Node processes.
  if (runningSync) return runningSync;

  runningSync = (async () => {
    const asOf = new Date();

    const subscriptions = await Subscription.find({
      status: 'active',
      billingVersion: 2,
      nextBillingDate: { $lte: asOf },
    })
      .select('_id')
      .lean();

    let processedPeriods = 0;

    for (const subscription of subscriptions) {
      processedPeriods += await syncSubscription(
        subscription._id,
        asOf
      );
    }

    return {
      checkedAt: asOf,
      processedPeriods,
    };
  })().finally(() => {
    runningSync = null;
  });

  return runningSync;
}