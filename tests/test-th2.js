const http = require('http');

function request(url, options = {}, body = null) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          duration: Date.now() - startTime,
          data: data ? JSON.parse(data) : {}
        });
      });
    });
    req.on('error', (err) => {
      resolve({
        error: err.code || err.message,
        duration: Date.now() - startTime
      });
    });
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  console.log('================================================================');
  console.log(' KIỂM THỬ TÌNH HUỐNG 2: Ngân hàng phản hồi chậm (DELAY_MS=5000)');
  console.log('================================================================\n');

  console.log('1. Gửi 1 thanh toán để đo timeout...');
  const t1 = await request('http://localhost:4001/students/1/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { amount: 100000 });

  console.log('-> Kết quả thanh toán:', JSON.stringify(t1, null, 2));
  console.log(`-> Mã trả về: ${t1.status} (Kỳ vọng: 504)`);
  console.log(`-> Trạng thái: ${t1.data?.status} (Kỳ vọng: PENDING)`);
  console.log(`-> Thời gian phản hồi: ${t1.duration}ms (Kỳ vọng: <= 4500ms)`);

  console.log('\n2. Bắn cùng lúc 20 thanh toán và đồng thời gọi GET /students/1/fees...');
  const paymentPromises = Array.from({ length: 20 }, (_, i) =>
    request('http://localhost:4001/students/1/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { amount: 50000 })
  );

  // Chờ 500ms sau khi bắn thanh toán rồi đo GET fee
  await new Promise(r => setTimeout(r, 500));
  console.log('-> Đang gọi GET /students/1/fees trong lúc 20 thanh toán đang treo...');
  const feeRes = await request('http://localhost:4001/students/1/fees', { method: 'GET' });
  console.log(`-> GET /fees phản hồi với mã ${feeRes.status} trong ${feeRes.duration}ms (Kỳ vọng: < 300ms)`);

  console.log('-> Đang đợi 20 thanh toán hoàn tất...');
  const results = await Promise.all(paymentPromises);
  const pendingCount = results.filter(r => r.status === 504 && r.data?.status === 'PENDING').length;
  console.log(`-> Số giao dịch trả 504 PENDING: ${pendingCount}/20`);
}

run();
