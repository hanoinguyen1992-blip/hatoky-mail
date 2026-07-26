/* ==========================================================================
   Cloudflare Email Worker Script (Catch-all Inbound Router)
   
   Cách dùng:
   1. Đăng nhập Cloudflare -> Chọn Domain -> Email -> Email Routing.
   2. Tạo một Cloudflare Worker mới và dán mã bên dưới vào.
   3. Thay thế `YOUR_BACKEND_WEBHOOK_URL` bằng URL máy chủ của anh
      (ví dụ: https://email-api.ducdz.com/api/webhook/email).
   4. Trong Email Routing -> Routing Rules -> Tạo Catch-All Rule trỏ tới Worker này.
   ========================================================================== */

import PostalMime from 'postal-mime';

export default {
    async email(message, env, ctx) {
        // Cấu hình URL Webhook Backend của anh
        const WEBHOOK_URL = env.WEBHOOK_URL || "https://your-backend-domain.com/api/webhook/email";

        try {
            // Đọc nội dung email thô (raw email stream)
            const rawEmail = await streamToArrayBuffer(message.raw, message.rawSize);
            
            // Parse email bằng PostalMime
            const parser = new PostalMime();
            const parsedEmail = await parser.parse(rawEmail);

            // Chuẩn bị payload dữ liệu gửi sang Backend Server
            const payload = {
                to: message.to,
                from: message.from,
                fromName: parsedEmail.from?.name || message.from,
                fromEmail: parsedEmail.from?.address || message.from,
                subject: parsedEmail.subject || '(No Subject)',
                text: parsedEmail.text || '',
                html: parsedEmail.html || `<p>${parsedEmail.text || ''}</p>`,
                attachmentsCount: parsedEmail.attachments?.length || 0
            };

            // Gửi HTTP POST Webhook tới Backend Server
            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Cloudflare-Secret': env.WEBHOOK_SECRET || 'kirato-secret-key'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                console.error(`Webhook error HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('Error processing email in Worker:', error);
        }
    }
};

// Helper stream converter
async function streamToArrayBuffer(stream, streamSize) {
    const result = new Uint8Array(streamSize);
    let bytesRead = 0;
    const reader = stream.getReader();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result.set(value, bytesRead);
        bytesRead += value.length;
    }

    return result.buffer;
}
