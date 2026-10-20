const http = require('http');

function request(url, options = {}, body = null) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = { raw: data }; }
        resolve({
          status: res.statusCode,
          duration: Date.now() - startTime,
          data: parsed
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
  console.log(' KIỂM THỬ TÌNH HUỐNG 1: Ngân hàng không kết nối được -> Bật lại');
  console.log('================================================================\n');

  // Bước 0: Kiểm tra Bank Service có đang chạy không
  const bankCheck = await request('http://localhost:4002/stats', { method: 'GET' });
  const isBankRunning = !bankCheck.error && bankCheck.status === 200;

  if (isBankRunning) {
    console.log('⚠️  CẢNH BÁO: Bank Service HIỆN ĐANG CHẠY (Port 4002 đang BẬT)!');
    console.log('-> Đề bài yêu cầu: TẮT Ngân hàng trước để kiểm tra khi Ngân hàng sập.');
    console.log('-> Bạn hãy sang Terminal của bank-service, nhấn Ctrl + C để TẮT Ngân hàng.');
    console.log('-> Sau đó chạy lại lệnh "node test-th1.js" này nhé!\n');
    console.log('--- Kết quả khi Bank đang bật ---');
  } else {
    console.log('✅ XÁC NHẬN: Bank Service đang TẮT đúng kịch bản đề bài!\n');
  }

  console.log('1. Đang gửi thanh toán kiểm tra phản hồi từ Fee Service...');
  const paymentRes = await request('http://localhost:4001/students/1/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { amount: 100000 });

  console.log('-> Kết quả thanh toán:', JSON.stringify(paymentRes, null, 2));
  
  if (!isBankRunning) {
    console.log(`-> Mã trả về: ${paymentRes.status} (Kỳ vọng: 503) => ${paymentRes.status === 503 ? 'ĐẠT CHUẨN ✅' : 'CHƯA ĐẠT ❌'}`);
    console.log(`-> Thời gian xử lý: ${paymentRes.duration}ms (Kỳ vọng: < 1500ms) => ${paymentRes.duration < 1500 ? 'ĐẠT CHUẨN ✅' : 'CHƯA ĐẠT ❌'}`);
    console.log(`-> Trạng thái: ${paymentRes.data?.status} (Kỳ vọng: FAILED) => ${paymentRes.data?.status === 'FAILED' ? 'ĐẠT CHUẨN ✅' : 'CHƯA ĐẠT ❌'}`);
  } else {
    console.log(`-> Mã trả về: ${paymentRes.status} (Vì Bank đang bật nên trả về 201 PAID)`);
  }

  console.log('\n2. Kiểm tra Fee Service có sống không bằng GET /students/1/fees...');
  const feeRes = await request('http://localhost:4001/students/1/fees', { method: 'GET' });
  console.log('-> Kết quả GET fees:', JSON.stringify(feeRes, null, 2));
  console.log(`-> Mã trả về: ${feeRes.status} (Kỳ vọng: 200) => ${feeRes.status === 200 ? 'ĐẠT CHUẨN ✅' : 'CHƯA ĐẠT ❌'}`);
  console.log(`-> Thời gian phản hồi: ${feeRes.duration}ms (Kỳ vọng nhanh < 100ms) => ${feeRes.duration < 100 ? 'ĐẠT CHUẨN ✅' : 'CHƯA ĐẠT ❌'}`);

  console.log('\n3. Bước tiếp theo để hoàn tất kiểm thử:');
  if (!isBankRunning) {
    console.log('-> Bây giờ bạn hãy BẬT Bank Service lên (gõ "node server.js" ở terminal bank-service).');
    console.log('-> Sau đó gửi lại thanh toán để chứng minh: Khi ngân hàng bật lại, thanh toán thành công 201 mà KHÔNG cần khởi động lại Fee Service!');
  } else {
    console.log('-> Để thấy mã 503, hãy tắt Bank Service (Ctrl+C) và chạy lại script này.');
  }
}

run();
