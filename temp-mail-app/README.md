# 📬 Kirato Temp Mail — Hướng Dẫn Cài Đặt & Triển Khai

Ứng dụng web email tạm thời (Temporary Email Service) giao diện Dark Glassmorphism, tự động cập nhật thư mới Real-time thông qua Server-Sent Events (SSE).

---

## 📁 Cấu Trúc Dự Án

- `index.html`: Giao diện ứng dụng (3 cột: Tạo email, Danh sách inbox, Khung đọc mail).
- `styles.css`: Bộ style Dark Mode cao cấp (Glassmorphism, animations).
- `app.js`: Logic xử lý phía Client, kết nối SSE real-time, bộ lọc & giả lập nhận mail.
- `server.js`: Máy chủ Node.js Express cung cấp API, nhận Webhook và đẩy SSE stream.
- `cloudflare-worker.js`: Script Cloudflare Worker nhận mail tự động từ tên miền.
- `package.json`: Cấu hình thư viện Node.js.

---

## 🚀 1. Chạy Thử Trên Máy Local (Development Mode)

Chỉ với 2 bước đơn giản để mở ứng dụng chạy thử ngay lập tức:

### Bước 1: Cài đặt dependencies
Mở Terminal trong thư mục dự án và chạy:
```bash
npm install
```

### Bước 2: Khởi chạy Server
```bash
npm start
```
Mở trình duyệt truy cập: `http://localhost:3000`

👉 **Test thử ngay:** Trên giao diện web, bấm nút **"Gửi mail thử (Simulate)"** ở góc dưới bên trái để thấy thư tự động xuất hiện real-time trong inbox!

---

## 🌐 2. Triển Khai Lên Mạng Thật (Production Deployment)

Đoạn hướng dẫn này giúp anh nhận được **EMAIL THẬT** gửi từ bất kỳ đâu (Gmail, Yahoo, Outlook...) tới tên miền cá nhân của anh (ví dụ: `anything@kirato.com`).

### Bước 1: Deploy Backend Server
1. Up toàn bộ code backend (`server.js`, `package.json`, `index.html`, `styles.css`, `app.js`) lên **Render.com**, **Railway.app**, **Vercel** hoặc **VPS Linux**.
2. Giả sử domain backend của anh sau khi deploy là: `https://email-api.kirato.com`

### Bước 2: Cấu hình Cloudflare Email Routing
1. Đăng nhập vào [Cloudflare Console](https://dash.cloudflare.com/).
2. Chọn tên miền của anh (ví dụ `kirato.com`) -> Vào mục **Email** -> **Email Routing**.
3. Bật tính năng Email Routing (Cloudflare sẽ tự động cập nhật các bản ghi MX DNS cho tên miền).

### Bước 3: Tạo Cloudflare Worker Nhận Mail
1. Trong Cloudflare Dashboard -> Vào **Workers & Pages** -> Bấm **Create Application** -> **Create Worker**.
2. Đặt tên (vd: `kirato-tempmail-worker`) rồi bấm Deploy.
3. Bấm **Edit code**, copy toàn bộ mã trong file `cloudflare-worker.js` dán vào.
4. Thay giá trị `WEBHOOK_URL` bằng URL máy chủ backend của anh (ví dụ: `https://email-api.kirato.com/api/webhook/email`).
5. Trong file worker, thêm package `postal-mime` ở phần settings (hoặc dùng `npm install postal-mime` nếu deploy qua Wrangler CLI).
6. Bấm **Save and Deploy**.

### Bước 4: Tạo Catch-All Rule
1. Quay lại trang quản lý Domain -> **Email** -> **Email Routing** -> Chọn tab **Routing Rules**.
2. Ở mục **Catch-all address**, bấm **Edit**.
3. Chọn Action: **Send to Worker** -> Chọn worker `kirato-tempmail-worker` vừa tạo -> Bấm **Save**.

🎉 **HOÀN THÀNH!**
Bây giờ bất kỳ ai gửi email tới `abc@kirato.com`, `test1234@kirato.com` hay bất kỳ địa chỉ nào thuộc domain của anh, thư sẽ được Cloudflare tự động đẩy về máy chủ và xuất hiện tức thì trên trang web giao diện người dùng!

