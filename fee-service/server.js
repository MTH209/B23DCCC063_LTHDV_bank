const express = require('express');
const http = require('http');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '4001', 10);
const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';

// 1. Dữ liệu in-memory học phí sinh viên theo đúng đề bài:
// Sinh viên 1: nợ 50.000.000đ; Sinh viên 2: nợ 0đ; Sinh viên 3: nợ 3.200.000đ
const students = {
  '1': { id: '1', name: 'Sinh viên 1', debt: 50000000 },
  '2': { id: '2', name: 'Sinh viên 2', debt: 0 },
  '3': { id: '3', name: 'Sinh viên 3', debt: 3200000 }
};

let paymentSeq = 0;
const payments = new Map();

// Helper sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 2. Cấu hình HTTP Agent với Keep-Alive và Connection Pool (đáp ứng Tình huống 3)
const keepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 20,         // Tối đa 20 socket đồng thời
  maxFreeSockets: 10,     // Giữ sẵn 10 socket rảnh rỗi trong pool
  timeout: 30000          // Socket timeout 30s
});

// Tạo instance axios chuyên dụng gọi sang Bank
const bankClient = axios.create({
  baseURL: BANK_URL,
  httpAgent: keepAliveAgent,
  timeout: 4000,          // Request Timeout: 4 giây (đảm bảo tổng thời gian <= 4.5s theo TH2)
  validateStatus: () => true // Không tự động throw khi status >= 400 để tự kiểm soát
});

// Endpoint reset data phục vụ test
app.post('/reset-data', (req, res) => {
  students['1'].debt = 50000000;
  students['2'].debt = 0;
  students['3'].debt = 3200000;
  payments.clear();
  paymentSeq = 0;
  console.log('[FEE] Reset student debts and payments to initial state.');
  res.json({ message: 'Reset data success', students });
});

// 3. API xem công nợ sinh viên (GET /students/:id/fees)
// Yêu cầu: Luôn phản hồi nhanh < 300ms kể cả khi có 20 thanh toán đang treo
app.get('/students/:id/fees', (req, res) => {
  const student = students[req.params.id];
  if (!student) {
    return res.status(404).json({ error: 'Không tìm thấy sinh viên' });
  }
  res.json({
    studentId: student.id,
    name: student.name,
    debt: student.debt
  });
});

// 4. Hàm helper gọi Ngân hàng với cơ chế Retry & Idempotency
async function callBankWithResilience(paymentId, amount) {
  const MAX_RETRIES = 2; // Thử lại tối đa 2 lần khi gặp lỗi tạm thời
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    attempt++;
    const startTime = Date.now();
    try {
      console.log(`[FEE] Calling Bank for ${paymentId} (Attempt ${attempt}/${MAX_RETRIES + 1})...`);
      
      const response = await bankClient.post('/charges', {
        reference: paymentId,
        amount
      }, {
        headers: {
          'Idempotency-Key': paymentId,
          'Content-Type': 'application/json'
        }
      });

      const elapsed = Date.now() - startTime;
      console.log(`[FEE] Bank responded with status ${response.status} in ${elapsed}ms`);

      // Trường hợp 1: Ngân hàng trừ tiền thành công (201)
      if (response.status === 201) {
        return {
          type: 'SUCCESS',
          httpStatus: 201,
          status: 'PAID',
          data: response.data
        };
      }

      // Trường hợp 2: Ngân hàng từ chối rõ ràng (4xx ví dụ 400, 402 vượt hạn mức)
      // TUYỆT ĐỐI KHÔNG RETRY!
      if (response.status >= 400 && response.status < 500) {
        return {
          type: 'REJECTED',
          httpStatus: response.status,
          status: 'FAILED',
          error: response.data?.error || 'Ngân hàng từ chối giao dịch'
        };
      }

      // Trường hợp 3: Ngân hàng trả lỗi 5xx tạm thời
      if (response.status >= 500) {
        console.warn(`[FEE] Bank returned ${response.status}. Retrying if attempts remain...`);
        if (attempt <= MAX_RETRIES) {
          await sleep(200); // Backoff ngắn
          continue;
        }
        return {
          type: 'SERVER_ERROR',
          httpStatus: 504,
          status: 'PENDING',
          error: 'Ngân hàng lỗi tạm thời (Hết lượt thử lại)'
        };
      }

    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.error(`[FEE] Call bank error on attempt ${attempt}: ${err.code || err.message} after ${elapsed}ms`);

      // 1. Lỗi không thể kết nối tới ngân hàng (ECONNREFUSED) -> Chắc chắn chưa trừ tiền
      if (err.code === 'ECONNREFUSED') {
        return {
          type: 'CONNECTION_REFUSED',
          httpStatus: 503,
          status: 'FAILED',
          error: 'Không thể kết nối tới ngân hàng'
        };
      }

      // 2. Lỗi timeout hoặc đứt socket giữa chừng (ECONNABORTED, ECONNRESET, socket hang up)
      // -> Không biết đã trừ tiền hay chưa!
      if (err.code === 'ECONNABORTED' || err.code === 'ECONNRESET' || err.message.includes('hang up') || err.message.includes('timeout')) {
        // Nếu là timeout, đã tốn ~4s, không retry để đảm bảo tổng thời gian <= 4.5s
        if (elapsed >= 3500) {
          return {
            type: 'TIMEOUT',
            httpStatus: 504,
            status: 'PENDING',
            error: 'Hết thời gian chờ phản hồi từ ngân hàng'
          };
        }

        // Nếu là rớt kết nối socket sớm (như DROP_RATE), có thể thử retry 1 lần với Idempotency-Key
        if (attempt <= MAX_RETRIES) {
          console.log(`[FEE] Socket dropped. Retrying with Idempotency-Key: ${paymentId}...`);
          await sleep(100);
          continue;
        }

        return {
          type: 'NETWORK_DROP',
          httpStatus: 504,
          status: 'PENDING',
          error: 'Đứt kết nối trong quá trình xử lý giao dịch'
        };
      }

      // Lỗi mạng khác
      if (attempt <= MAX_RETRIES) {
        await sleep(150);
        continue;
      }

      return {
        type: 'UNKNOWN',
        httpStatus: 504,
        status: 'PENDING',
        error: err.message || 'Lỗi không xác định khi giao tiếp với ngân hàng'
      };
    }
  }
}

// 5. API thanh toán học phí (POST /students/:id/payments)
app.post('/students/:id/payments', async (req, res) => {
  const student = students[req.params.id];
  if (!student) {
    return res.status(404).json({ error: 'Không tìm thấy sinh viên' });
  }

  const { amount } = req.body || {};
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Số tiền không hợp lệ' });
  }

  // Kiểm tra không vượt công nợ
  if (amount > student.debt) {
    return res.status(400).json({
      error: 'Số tiền thanh toán vượt quá công nợ hiện tại',
      currentDebt: student.debt
    });
  }

  // Tạo mã lệnh thanh toán (P1, P2...)
  paymentSeq++;
  const paymentId = 'P' + paymentSeq;

  const paymentRecord = {
    paymentId,
    studentId: student.id,
    amount,
    status: 'INIT',
    createdAt: new Date().toISOString()
  };
  payments.set(paymentId, paymentRecord);

  // Gọi ngân hàng
  const result = await callBankWithResilience(paymentId, amount);

  // Quy tắc nghiệp vụ: Công nợ CHỈ giảm khi ngân hàng đã xác nhận trừ tiền (PAID)
  if (result.status === 'PAID') {
    student.debt -= amount;
    paymentRecord.status = 'PAID';
    paymentRecord.chargeId = result.data?.chargeId;
    console.log(`[FEE] Payment ${paymentId} PAID. New debt for SV ${student.id}: ${student.debt}`);

    return res.status(201).json({
      paymentId,
      status: 'PAID',
      chargeId: result.data?.chargeId,
      amount,
      remainingDebt: student.debt
    });
  }

  // Nếu ngân hàng từ chối rõ ràng hoặc lỗi
  paymentRecord.status = result.status;
  paymentRecord.error = result.error;

  return res.status(result.httpStatus).json({
    paymentId,
    status: result.status,
    error: result.error
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[FEE SERVICE] Running on http://localhost:${PORT}`);
  console.log(`[FEE SERVICE] Connected to Bank at: ${BANK_URL}`);
});

