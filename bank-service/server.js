const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '4002', 10);
const DELAY_MS = parseInt(process.env.DELAY_MS || '0', 10);
const FAIL_RATE = parseFloat(process.env.FAIL_RATE || '0');
const DROP_RATE = parseFloat(process.env.DROP_RATE || '0');

let connections = 0;
let requests = 0;
let charges = 0;
let duplicates = 0;

// In-memory store: idempotencyKey -> charge record
const chargesMap = new Map();

// Helper sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. Endpoint xem thống kê
app.get('/stats', (req, res) => {
  res.json({
    connections,
    requests,
    charges,
    duplicates
  });
});

// Endpoint reset stats để phục vụ test độc lập từng kịch bản
app.post('/reset-stats', (req, res) => {
  connections = 0;
  requests = 0;
  charges = 0;
  duplicates = 0;
  chargesMap.clear();
  console.log('[BANK] Stats reset successfully');
  res.json({ message: 'Stats reset successfully' });
});

// 2. Endpoint xử lý thanh toán / trừ tiền
app.post('/charges', async (req, res) => {
  requests++;
  const { reference, amount } = req.body || {};
  const idempotencyKey = req.header('Idempotency-Key') || reference;

  console.log(`[BANK] Charge request: ref=${reference}, amount=${amount}, key=${idempotencyKey}`);

  // Mô phỏng độ trễ
  if (DELAY_MS > 0) {
    await sleep(DELAY_MS);
  }

  // Validate số tiền
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Số tiền không hợp lệ' });
  }

  // Validate hạn mức (20.000.000đ) -> 402 Payment Required
  if (amount > 20000000) {
    console.log(`[BANK] Amount ${amount} exceeds 20.000.000 limit. Rejecting 402.`);
    return res.status(402).json({ error: 'Vượt hạn mức 20.000.000đ' });
  }

  // Kiểm tra Idempotency
  if (idempotencyKey && chargesMap.has(idempotencyKey)) {
    const existing = chargesMap.get(idempotencyKey);
    console.log(`[BANK] Idempotency match for key: ${idempotencyKey}. Returning existing charge: ${existing.chargeId}`);
    return res.status(201).json({
      chargeId: existing.chargeId,
      reference: existing.reference,
      amount: existing.amount,
      status: 'PAID',
      idempotentReplay: true
    });
  }

  // Mô phỏng FAIL_RATE: Lỗi 500 TRƯỚC KHI trừ tiền
  if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
    console.log('[BANK] Simulated temporary failure before charging (500)');
    return res.status(500).json({ error: 'Lỗi máy chủ ngân hàng tạm thời (Simulated 500)' });
  }

  // Thực hiện trừ tiền
  const chargeId = 'CHG_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  const chargeRecord = {
    chargeId,
    reference,
    amount,
    createdAt: new Date().toISOString()
  };

  if (idempotencyKey) {
    chargesMap.set(idempotencyKey, chargeRecord);
  }
  charges++;
  console.log(`[BANK] Charge successful: ${chargeId}, total charges: ${charges}`);

  // Mô phỏng DROP_RATE: Trừ tiền xong rồi CẮT kết nối socket trước khi trả lời
  if (DROP_RATE > 0 && Math.random() < DROP_RATE) {
    console.log('[BANK] Simulated network drop AFTER charging! Destroying socket immediately...');
    req.socket.destroy();
    return;
  }

  res.status(201).json({
    chargeId,
    reference,
    amount,
    status: 'PAID'
  });
});

const server = http.createServer(app);

// Keep-Alive timeout: 5 giây
server.keepAliveTimeout = 5000;
server.headersTimeout = 6000;

server.on('connection', (socket) => {
  connections++;
  console.log(`[BANK] [TCP] New connection accepted. Total: ${connections}`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[BANK SERVICE] Started on http://localhost:${PORT}`);
  console.log(`[BANK SERVICE] DELAY_MS=${DELAY_MS}, FAIL_RATE=${FAIL_RATE}, DROP_RATE=${DROP_RATE}`);
});

