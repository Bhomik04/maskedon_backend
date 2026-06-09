// Diagnostic: check payment records for a event and test the Cashfree order
require('dotenv').config();
const { Pool } = require('pg');

const EVENT_ID = 'adb5a535-c126-4fe3-b2fd-eea8798ebf7c';
const BASE = process.env.CASHFREE_SANDBOX === 'true'
  ? 'https://sandbox.cashfree.com/pg'
  : 'https://api.cashfree.com/pg';

async function main() {
  console.log('CASHFREE_SANDBOX =', process.env.CASHFREE_SANDBOX);
  console.log('API base:', BASE);
  console.log('APP_ID set:', !!process.env.CASHFREE_APP_ID);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const result = await pool.query(
    `SELECT id, payer_id, status, razorpay_order_id, razorpay_payment_id, amount, tier_id, created_at
     FROM payments
     WHERE event_id = $1
     ORDER BY created_at DESC`,
    [EVENT_ID]
  );
  await pool.end();

  console.log('\n=== PAYMENT RECORDS ===');
  console.log(JSON.stringify(result.rows, null, 2));

  // Now test each order ID against Cashfree
  const headers = {
    'x-api-version': '2023-08-01',
    'x-client-id': process.env.CASHFREE_APP_ID,
    'x-client-secret': process.env.CASHFREE_SECRET_KEY,
    'Content-Type': 'application/json',
  };

  for (const row of result.rows) {
    if (!row.razorpay_order_id) continue;
    console.log(`\n=== Cashfree check for order: ${row.razorpay_order_id} ===`);
    try {
      const res = await fetch(`${BASE}/orders/${encodeURIComponent(row.razorpay_order_id)}`, {
        method: 'GET', headers
      });
      const text = await res.text();
      console.log('HTTP status:', res.status);
      console.log('Body:', text);
    } catch (e) {
      console.error('Fetch error:', e.message);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
