import {
  Expense,
  Member,
  Payment,
  Subscription,
} from '../models/index.js';

import { syncInvoices } from './billingService.js';

import {
  currentMonth,
  dateRange,
  fromCents,
  paymentView,
  sumMoney,
  toCents,
} from '../utils/helpers.js';

export async function buildFinancialReport(query) {
  await syncInvoices();

  const range = dateRange(query);

  const dateFilter = {
    $gte: range.start,
    $lt: range.endExclusive,
  };

  const [
    receiptInvoices,
    billedInvoices,
    expenses,
    outstandingInvoices,
    legacyTotals,
    totalMembers,
    activeSubscriptions,
  ] = await Promise.all([
    Payment.find({
      transactions: {
        $elemMatch: {
          receivedAt: dateFilter,
        },
      },
    })
      .populate('memberId', 'fullName phone memberId')
      .lean(),

    Payment.find({
      periodStart: dateFilter,
      legacy: false,
    }).lean(),

    Expense.find({
      date: dateFilter,
    })
      .sort({ date: 1 })
      .lean(),

    Payment.find({
      remainingBalance: { $gt: 0 },
    })
      .populate('memberId', 'fullName phone memberId')
      .populate('serviceId', 'name')
      .sort({ billingMonth: 1, createdAt: 1 })
      .lean(),

    Payment.aggregate([
      {
        $group: {
          _id: null,
          historicalReceivedWithoutDates: {
            $sum: '$legacyPaidAmount',
          },
        },
      },
    ]),

    Member.countDocuments(),

    Subscription.countDocuments({
      status: 'active',
      startDate: { $lte: new Date() },
    }),
  ]);

  const receipts = [];

  for (const invoice of receiptInvoices) {
    for (const transaction of invoice.transactions || []) {
      const receivedAt = new Date(transaction.receivedAt);

      if (
        receivedAt >= range.start &&
        receivedAt < range.endExclusive
      ) {
        receipts.push({
          ...transaction,

          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,

          billingMonth: invoice.billingMonth || null,
          member: invoice.memberId,
        });
      }
    }
  }

  receipts.sort(
    (a, b) => new Date(a.receivedAt) - new Date(b.receivedAt)
  );

  const totalIncome = sumMoney(receipts, (row) => row.amount);
  const totalExpenses = sumMoney(expenses, (row) => row.amount);

  const monthlyMap = new Map();

  const ensureMonth = (month) => {
    if (!monthlyMap.has(month)) {
      monthlyMap.set(month, {
        month,
        incomeCents: 0,
        expenseCents: 0,
      });
    }

    return monthlyMap.get(month);
  };

  for (const receipt of receipts) {
    ensureMonth(currentMonth(receipt.receivedAt)).incomeCents +=
      toCents(receipt.amount);
  }

  for (const expense of expenses) {
    ensureMonth(currentMonth(expense.date)).expenseCents +=
      toCents(expense.amount);
  }

  const monthly = [...monthlyMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => ({
      month: row.month,
      income: fromCents(row.incomeCents),
      expenses: fromCents(row.expenseCents),
      netProfit: fromCents(row.incomeCents - row.expenseCents),
    }));

  const categoryMap = new Map();

  for (const expense of expenses) {
    categoryMap.set(
      expense.category,
      (categoryMap.get(expense.category) || 0) +
        toCents(expense.amount)
    );
  }

  const expensesByCategory = [...categoryMap.entries()]
    .map(([category, cents]) => ({
      category,
      amount: fromCents(cents),
    }))
    .sort((a, b) => b.amount - a.amount);

  const methodMap = new Map();

  for (const receipt of receipts) {
    methodMap.set(
      receipt.method,
      (methodMap.get(receipt.method) || 0) +
        toCents(receipt.amount)
    );
  }

  const incomeByMethod = [...methodMap.entries()].map(
    ([method, cents]) => ({
      method,
      amount: fromCents(cents),
    })
  );

  const thisMonth = currentMonth();

  const previousDues = outstandingInvoices.filter(
    (invoice) =>
      !invoice.legacy &&
      invoice.billingMonth &&
      invoice.billingMonth < thisMonth
  );

  const legacyOutstanding = outstandingInvoices.filter(
    (invoice) => invoice.legacy
  );

  const historicalReceivedWithoutDates =
    legacyTotals[0]?.historicalReceivedWithoutDates || 0;

  const notes = [
    'Income uses actual receipt dates.',
    'Expenses use expense dates.',
    'Net profit shown here is cash income minus recorded expenses.',
    'Outstanding balances and member counts are current snapshots, not historical end-date snapshots.',
    'Legacy balances have no verified billing-month allocation.',
  ];

  if (historicalReceivedWithoutDates > 0) {
    notes.push(
      'Historical receipts without installment dates are excluded from date-filtered income.'
    );
  }

  return {
    gymName: process.env.GYM_NAME || 'Gym',
    currency: process.env.CURRENCY || 'PKR',

    generatedAt: new Date(),

    period: {
      startDate: range.startDate,
      endDate: range.endDate,
    },

    totalIncome,
    totalExpenses,

    netProfit: fromCents(
      toCents(totalIncome) - toCents(totalExpenses)
    ),

    paymentsCount: receipts.length,
    expensesCount: expenses.length,

    totalBilled: sumMoney(
      billedInvoices,
      (invoice) => invoice.amountCharged
    ),

    invoicesCount: billedInvoices.length,

    invoiceStatusCounts: {
      paid: billedInvoices.filter((invoice) => invoice.status === 'paid').length,
      partial: billedInvoices.filter((invoice) => invoice.status === 'partial').length,
      unpaid: billedInvoices.filter((invoice) => invoice.status === 'unpaid').length,
    },

    current: {
      asOf: new Date(),

      totalMembers,
      activeSubscriptions,

      outstandingBalance: sumMoney(
        outstandingInvoices,
        (invoice) => invoice.remainingBalance
      ),

      previousMonthsDue: sumMoney(
        previousDues,
        (invoice) => invoice.remainingBalance
      ),

      legacyUnallocatedDue: sumMoney(
        legacyOutstanding,
        (invoice) => invoice.remainingBalance
      ),

      outstandingInvoicesCount: outstandingInvoices.length,
    },

    historicalReceivedWithoutDates,

    monthly,
    expensesByCategory,
    incomeByMethod,

    receipts,
    expenses,

    outstandingInvoices: outstandingInvoices.map(paymentView),

    notes,
  };
}