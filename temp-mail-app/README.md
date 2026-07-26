# 📬 Hatoky Temp Mail — Hướng Dẫn Cài Đặt & Triển Khai

Ứng dụng web email tạm thời (Temporary Email Service), tự động cập nhật thư mới Real-time thông qua Server-Sent Events (SSE). **Chỉ nhận thư (receive-only)** — thư tự động xóa sau **60 phút**.

---

## 📁 Cấu Trúc Dự Án

- `index.html`: Giao diện ứng dụng (Tạo email, Danh sách inbox, Khung đọc mail).
- `styles.css`: Bộ style Light/Dark Mode (Glassmorphism, animations).
- `app.js`: Logic phía Client — kết nối SSE real-time, tự nhận diện mã OTP, khôi phục địa chỉ sau khi tải lại trang.
- `server.js`: Máy chủ Node.js Express — API, Webhook, SSE stream, tự động dọn thư hết hạn.
- `cloudflare-worker.js`: Script Cloudflare Worker nhận mail thật từ tên miền (decode UTF-8 chuẩn cho tiếng Việt).
- `package.json`: Cấu hình thư viện Node.js.

---

## ✨ Tính Năng Chính

- **Real-time SSE**: thư mới hiện ngay lập tức, không cần bấm Refresh.
- **Tự nhận diện OTP**: mã xác minh 4–8 số được tách ra, hiện badge 🔑 — bấm vào badge để sao chép ngay.
- **Tự động xóa (Auto-delete)**: thư hết hạn sau 60 phút; mỗi hộp thư giữ tối đa 50 thư mới nhất.
- **Khôi phục phiên**: tải lại trang vẫn giữ nguyên địa chỉ email và hộp thư (trong thời gian TTL).
- **Xóa thư**: xóa từng thư hoặc xóa cả hộp thư (đồng bộ cả server, không hiện lại khi refresh).
- **Chỉ nhận thư**: tính năng gửi thư đi (Compose/Send) chưa được hỗ trợ — nút Send sẽ báo rõ điều này.

---

## 🚀 1. Chạy Thử Trên Máy Local (Development Mode)

### Bước 1: Cài đặt dependencies
```bash
npm install
```

### Bước 2: Khởi chạy Server
```bash
npm start
```
Mở trình duyệt truy cập: `http://localhost:3000`

👉 **Test thử ngay:** Nhập username (hoặc để trống) → bấm **Get Email** → bấm nút **"Send Test (Simulate)"** để thấy thư OTP tự động xuất hiện real-time trong inbox!

💡 Chế độ tự reload khi sửa code: `npm run dev`

---

## 🔌 API Backend

| Method | Endpoint | Mô tả |
| --- | --- | --- |
| `GET` | `/api/stream?address=...` | SSE stream nhận thư real-time |
| `GET` | `/api/messages?address=...` | Lấy danh sách thư đã lưu |
| `DELETE` | `/api/messages?address=...&id=...` | Xóa 1 thư (bỏ `id` để xóa cả hộp thư) |
| `POST` | `/api/webhook/email` | Webhook nhận thư từ Cloudflare Worker |
| `POST` | `/api/simulate-email` | Giả lập thư đến (test) |
| `GET` | `/api/health` | Health check cho Render/Railway |

### 🔒 Bảo vệ Webhook (khuyến nghị khi deploy)
Đặt biến môi trường `WEBHOOK_SECRET` trên **cả hai phía**:
- Backend server (Render/Railway/VPS): `WEBHOOK_SECRET=chuoi-bi-mat-cua-anh`
- Cloudflare Worker (Settings → Variables): `WEBHOOK_SECRET=chuoi-bi-mat-cua-anh`

Khi đã đặt, server chỉ chấp nhận webhook có header `x-webhook-secret` đúng — chặn người lạ bơm thư giả vào hệ thống.

---

## 🌐 2. Triển Khai Lên Mạng Thật (Production Deployment)

Đoạn hướng dẫn này giúp anh nhận được **EMAIL THẬT** gửi từ bất kỳ đâu (Gmail, Yahoo, Outlook...) tới tên miền cá nhân của anh (ví dụ: `anything@hatoky.xyz`).

### Bước 1: Deploy Backend Server
1. Up toàn bộ code backend (`server.js`, `package.json`, `index.html`, `styles.css`, `app.js`) lên **Render.com**, **Railway.app** hoặc **VPS Linux**.
2. Giả sử domain backend của anh sau khi deploy là: `https://hatoky-mail.onrender.com`

### Bước 2: Cấu hình Cloudflare Email Routing
1. Đăng nhập vào [Cloudflare Console](https://dash.cloudflare.com/).
2. Chọn tên miền của anh (ví dụ `hatoky.xyz`) -> Vào mục **Email** -> **Email Routing**.
3. Bật tính năng Email Routing (Cloudflare sẽ tự động cập nhật các bản ghi MX DNS cho tên miền).

### Bước 3: Tạo Cloudflare Worker Nhận Mail
1. Trong Cloudflare Dashboard -> Vào **Workers & Pages** -> Bấm **Create Application** -> **Create Worker**.
2. Đặt tên (vd: `hatoky-tempmail-worker`) rồi bấm Deploy.
3. Bấm **Edit code**, copy toàn bộ mã trong file `cloudflare-worker.js` dán vào.
4. Vào **Settings → Variables**, thêm `WEBHOOK_URL` = URL backend của anh (ví dụ: `https://hatoky-mail.onrender.com/api/webhook/email`) và `WEBHOOK_SECRET` (nếu dùng).
5. Bấm **Save and Deploy**.

### Bước 4: Tạo Catch-All Rule
1. Quay lại trang quản lý Domain -> **Email** -> **Email Routing** -> Chọn tab **Routing Rules**.
2. Ở mục **Catch-all address**, bấm **Edit**.
3. Chọn Action: **Send to Worker** -> Chọn worker `hatoky-tempmail-worker` vừa tạo -> Bấm **Save**.

🎉 **HOÀN THÀNH!**
Bây giờ bất kỳ ai gửi email tới `abc@hatoky.xyz`, `test1234@hatoky.xyz` hay bất kỳ địa chỉ nào thuộc domain của anh, thư sẽ được Cloudflare tự động đẩy về máy chủ và xuất hiện tức thì trên trang web giao diện người dùng!

> ⚠️ **Lưu ý sử dụng**: dịch vụ chỉ dành cho mục đích hợp pháp (đăng ký dịch vụ, test hệ thống, bảo vệ quyền riêng tư, giảm spam) — xem mục Terms trong ứng dụng.
