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
  console.log(' KIỂM THỬ TÌNH HUỐNG 4: Đứt kết nối, Lỗi tạm thời, Bị từ chối');
  console.log('================================================================\n');

  console.log('--- PHẦN C: Kiểm tra từ chối thanh toán 25.000.000đ (Vượt hạn mức 20tr) ---');
  const rejectRes = await request('http://localhost:4001/students/1/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { amount: 25000000 });

  console.log('-> Kết quả thanh toán 25tr:', JSON.stringify(rejectRes, null, 2));
  console.log(`-> Mã trả về: ${rejectRes.status} (Kỳ vọng: 402)`);
  console.log(`-> Trạng thái: ${rejectRes.data?.status} (Kỳ vọng: FAILED)`);

  console.log('\n--- HƯỚNG DẪN TEST PHẦN A & B:');
  console.log('• Phần A (DROP_RATE=0.3):');
  console.log('  Khởi động Bank với cờ DROP_RATE=0.3 (ví dụ: $env:DROP_RATE="0.3"; node bank-service/server.js)');
  console.log('  Gửi 60 thanh toán lần lượt, kiểm tra duplicates = 0, >= 54/60 thành công.');
  console.log('• Phần B (FAIL_RATE=0.3):');
  console.log('  Khởi động Bank với cờ FAIL_RATE=0.3 (ví dụ: $env:FAIL_RATE="0.3"; node bank-service/server.js)');
  console.log('  Gửi 60 thanh toán lần lượt, kiểm tra >= 54/60 thành công nhờ cơ chế Retry an toàn.');
}

run();
