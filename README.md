# HỆ THỐNG THANH TOÁN HỌC PHÍ & DUY TRÌ KẾT NỐI

Dự án mô phỏng kết nối và duy trì kết nối bền bỉ (Resilience) giữa **Fee Service** và **Ngân hàng giả lập**

---

## HƯỚNG DẪN CÀI ĐẶT & CHẠY

### 1. Cài đặt dependencies:
```bash
cd bank-service && npm install
cd ../fee-service && npm install
```

### 2. Khởi chạy các Service:
- **Terminal 1: Chạy Ngân hàng (Port 4002)**
  ```bash
  node bank-service/server.js
  ```
- **Terminal 2: Chạy Fee Service (Port 4001)**
  ```bash
  node fee-service/server.js
  ```

---

## 🧪 CHẠY BỘ KIỂM THỬ 4 TÌNH HUỐNG (TEST SCENARIOS)

Mở **Terminal 3** để chạy các kịch bản đo đạc:

### 🔹 Tình huống 1: Ngân hàng không kết nối được -> rồi bật lại
1. Tắt Bank Service (Ctrl+C ở Terminal 1).
2. Chạy test:
   ```bash
   node tests/test-th1.js
   ```
3. Bật lại Bank Service và gửi lại thanh toán để kiểm tra trả về 201.

### 🔹 Tình huống 2: Ngân hàng phản hồi rất chậm (DELAY_MS=5000)
1. Chạy Bank với DELAY_MS:
   ```bash
   $env:DELAY_MS="5000"; node bank-service/server.js
   ```
2. Chạy test:
   ```bash
   node tests/test-th2.js
   ```

### 🔹 Tình huống 3: Duy trì kết nối TCP (Keep-Alive)
1. Chạy Bank bình thường.
2. Chạy test gửi 200 giao dịch (10 đồng thời):
   ```bash
   node tests/test-th3.js
   ```
3. Quan sát: 200/200 thành công, số TCP connection <= 20.

### 🔹 Tình huống 4: Đứt kết nối (DROP_RATE) và Lỗi tạm thời (FAIL_RATE)
- Chạy với DROP_RATE:
  ```bash
  $env:DROP_RATE="0.3"; node bank-service/server.js
  ```
- Chạy với FAIL_RATE:
  ```bash
  $env:FAIL_RATE="0.3"; node bank-service/server.js
  ```
- Chạy test:
  ```bash
  node tests/test-th4.js
  ```
