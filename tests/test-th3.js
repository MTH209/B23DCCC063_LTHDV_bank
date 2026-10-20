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
  console.log(' KIỂM THỬ TÌNH HUỐNG 3: Duy trì kết nối TCP (Keep-Alive)');
  console.log('================================================================\n');

  // Reset stats ở ngân hàng trước khi test
  await request('http://localhost:4002/reset-stats', { method: 'POST' });

  const TOTAL_PAYMENTS = 200;
  const CONCURRENCY = 10;
  console.log(`Bắt đầu gửi ${TOTAL_PAYMENTS} thanh toán với concurrency = ${CONCURRENCY} (1.000đ mỗi lần)...`);

  const startTotalTime = Date.now();
  let completed = 0;
  let successCount = 0;

  async function worker() {
    while (completed < TOTAL_PAYMENTS) {
      completed++;
      const res = await request('http://localhost:4001/students/1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { amount: 1000 });
      if (res.status === 201 && res.data?.status === 'PAID') {
        successCount++;
      }
    }
  }

  // Chạy đồng thời CONCURRENCY workers
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  const totalDuration = Date.now() - startTotalTime;

  console.log(`\n-> Hoàn thành ${TOTAL_PAYMENTS} thanh toán trong ${totalDuration}ms`);
  console.log(`-> Số giao dịch thành công: ${successCount}/${TOTAL_PAYMENTS}`);

  // Kiểm tra stats ở Ngân hàng
  const statsRes = await request('http://localhost:4002/stats', { method: 'GET' });
  console.log('-> Thống kê từ Ngân hàng (/stats):', JSON.stringify(statsRes.data, null, 2));
  console.log(`-> Số kết nối TCP đã mở: ${statsRes.data.connections} (Kỳ vọng: <= 20)`);
  console.log(`-> Số duplicates: ${statsRes.data.duplicates} (Kỳ vọng: 0)`);

  console.log('\nĐang kiểm tra tính năng phục hồi sau khi nhàn rỗi 6 giây (Bank đã đóng idle connection)...');
  await new Promise(r => setTimeout(r, 6000));

  const afterIdleRes = await request('http://localhost:4001/students/1/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { amount: 1000 });
  console.log('-> Giao dịch sau 6 giây nhàn rỗi:', JSON.stringify(afterIdleRes, null, 2));
  console.log(`-> Kết quả: ${afterIdleRes.status === 201 ? 'THÀNH CÔNG (201)' : 'THẤT BẠI'}`);
}

run();
