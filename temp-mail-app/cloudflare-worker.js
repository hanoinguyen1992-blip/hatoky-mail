/* ==========================================================================
   Hatoky Universal OTP & RFC-2047 Decoded Mail Worker
   ========================================================================== */

export default {
    async email(message, env, ctx) {
        const WEBHOOK_URL = env.WEBHOOK_URL || "https://hatoky-mail.onrender.com/api/webhook/email";
        // Optional: set WEBHOOK_SECRET in Worker settings AND on the backend server
        const WEBHOOK_SECRET = env.WEBHOOK_SECRET || '';

        let payload;
        try {
            const rawSubject = message.headers.get('subject') || '(No Subject)';
            const subject = decodeRFC2047(rawSubject);

            const from = message.from || message.headers.get('from') || 'unknown@sender';
            const rawTo = message.to || message.headers.get('to') || '';
            // "John Doe <john@x.com>" -> "john@x.com"
            const toClean = ((rawTo.match(/<([^>]+)>/) || [])[1] || rawTo)
                .replace(/[<>]/g, '').trim().toLowerCase();

            // Read raw MIME content
            let rawMime = '';
            try {
                const reader = message.raw.getReader();
                const decoder = new TextDecoder('utf-8');
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    rawMime += decoder.decode(value, { stream: true });
                }
                rawMime += decoder.decode(); // flush any trailing multi-byte character
            } catch (e) {
                console.warn('Error reading raw stream:', e);
            }

            // Per-part MIME parsing: prefer text/plain, decode by each part's own CTE
            const cleanText = extractBestTextPart(rawMime) || subject;

            // Extract Strict Pure Numeric OTP (4 to 8 Digits)
            const extractedOtp = extractPureOtp(subject, cleanText);

            const fromNameClean = decodeRFC2047((from.split('<')[0] || from).replace(/"/g, '').trim());
            const fromEmailClean = (from.match(/<([^>]+)>/) || [])[1] || from;

            // NOTE: no OTP banner here — the frontend renders exactly one banner from otpCode
            payload = {
                to: toClean,
                from: from,
                fromName: fromNameClean || 'Unknown Sender',
                fromEmail: fromEmailClean,
                subject: subject,
                text: cleanText,
                html: `<div style="font-family: system-ui, -apple-system, sans-serif; padding: 16px; color: #0f172a; line-height: 1.6;">${escapeHtml(cleanText).replace(/\n/g, '<br>')}</div>`,
                otpCode: extractedOtp
            };
        } catch (error) {
            console.error('[Worker Parse Error]:', error);
            // Parsing failed — still deliver a minimal record instead of losing the mail
            payload = {
                to: (message.to || '').toLowerCase(),
                from: message.from || 'unknown@sender',
                fromName: message.from || 'Unknown Sender',
                fromEmail: message.from || 'unknown@sender',
                subject: message.headers.get('subject') || '(No Subject)',
                text: '',
                html: '<p>(Không đọc được nội dung thư)</p>',
                otpCode: null
            };
        }

        try {
            const resp = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(WEBHOOK_SECRET ? { 'x-webhook-secret': WEBHOOK_SECRET } : {})
                },
                body: JSON.stringify(payload)
            });
            if (!resp.ok) {
                throw new Error(`Webhook responded ${resp.status}`);
            }
            // Do not log the OTP value itself — codes are sensitive
            console.log(`[Worker] Delivered mail for: ${payload.to} | OTP found: ${payload.otpCode ? 'yes' : 'no'}`);
        } catch (error) {
            console.error('[Worker Delivery Error]:', error);
            // Reject so the sending server retries later instead of the mail vanishing
            message.setReject('Mailbox temporarily unavailable, please retry later');
        }
    }
};

// Strict Pure Numeric OTP Extractor (Prevents "41506Kh" or "ults" garbage strings)
function extractPureOtp(subject, text) {
    const combined = `${subject || ''} ${text || ''}`;

    // Priority 1: 4 to 8 pure digits right after an OTP keyword
    const keywordDigitMatch = combined.match(/(?:code|mã|otp|pin|passcode|verification|verify|secret|security|confirm|confirmation|auth)[^\d]*\b(\d{4,8})\b/i);
    if (keywordDigitMatch && keywordDigitMatch[1]) {
        return keywordDigitMatch[1];
    }

    // Fallbacks require an OTP keyword SOMEWHERE in the mail — otherwise
    // years/order numbers/prices would trigger false OTP banners
    const hasOtpKeyword = /(code|mã|otp|pin|passcode|verification|verify|xác minh|xác nhận|confirm|auth)/i.test(combined);
    if (!hasOtpKeyword) return null;

    // Priority 2: Pure 4-8 digit number in Subject line (Facebook/Google/TikTok put OTP first!)
    const subjectDigitMatch = (subject || '').match(/\b(\d{4,8})\b/);
    if (subjectDigitMatch) {
        return subjectDigitMatch[1];
    }

    // Priority 3: Standalone 4 to 8 digits in body
    const bodyDigitMatch = combined.match(/\b(\d{4,8})\b/);
    return bodyDigitMatch ? bodyDigitMatch[1] : null;
}

// --------------------------------------------------------------------------
// MIME helpers
// --------------------------------------------------------------------------

function splitHeadersBody(raw) {
    const sep = raw.indexOf('\r\n\r\n');
    if (sep === -1) return { headers: raw, body: '' };
    return { headers: raw.slice(0, sep), body: raw.slice(sep + 4) };
}

function decodeByCte(headers, body) {
    if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers)) {
        return decodeQuotedPrintable(body);
    }
    if (/Content-Transfer-Encoding:\s*base64/i.test(headers)) {
        return decodeBase64(body) ?? body;
    }
    return body;
}

// Extract the most readable text from a raw MIME message.
// Handles multipart (nested up to 3 levels) and single-part; prefers text/plain.
function extractBestTextPart(raw, depth = 0) {
    if (!raw) return '';
    const { headers, body } = splitHeadersBody(raw);

    const boundaryMatch = headers.match(/boundary="?([^";\r\n]+)"?/i);
    if (boundaryMatch && depth < 3) {
        const parts = [];
        for (const seg of raw.split('--' + boundaryMatch[1]).slice(1)) {
            if (seg.startsWith('--')) break; // closing delimiter
            parts.push(splitHeadersBody(seg.replace(/^\r\n/, '')));
        }
        const pick = parts.find(p => /Content-Type:\s*text\/plain/i.test(p.headers))
            || parts.find(p => /Content-Type:\s*multipart\//i.test(p.headers))
            || parts.find(p => /Content-Type:\s*text\/html/i.test(p.headers))
            || parts[0];
        if (!pick) return '';
        if (/Content-Type:\s*multipart\//i.test(pick.headers)) {
            return extractBestTextPart(pick.headers + '\r\n\r\n' + pick.body, depth + 1);
        }
        let text = decodeByCte(pick.headers, pick.body);
        if (/Content-Type:\s*text\/html/i.test(pick.headers)) {
            text = stripHtml(text);
        }
        return text.trim();
    }

    // Single-part message
    let text = decodeByCte(headers, body || raw);
    if (/Content-Type:\s*text\/html/i.test(headers)) {
        text = stripHtml(text);
    }
    return text.trim();
}

// Reduce an HTML body to readable plain text
function stripHtml(html) {
    return String(html || '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// RFC 2047 Header Decoder (Converts =?UTF-8?B?...?= into clear Vietnamese text)
function decodeRFC2047(header) {
    if (!header) return '(No Subject)';
    return header.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (match, b64) => {
        const decoded = decodeBase64(b64);
        return decoded === null ? match : decoded;
    }).replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (match, qp) => {
        try {
            return decodeQuotedPrintable(qp.replace(/_/g, ' '));
        } catch (e) { return match; }
    });
}

// Quoted-Printable Decoder (UTF-8 aware: collects =XX bytes, then decodes as UTF-8
// so multi-byte Vietnamese characters are not mangled)
function decodeQuotedPrintable(str) {
    const cleaned = String(str || '').replace(/=\r?\n/g, ''); // strip soft line breaks
    const bytes = [];
    for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === '=' && /^[0-9A-Fa-f]{2}/.test(cleaned.slice(i + 1, i + 3))) {
            bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            bytes.push(cleaned.charCodeAt(i) & 0xff);
        }
    }
    try {
        return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } catch (e) {
        return cleaned;
    }
}

// Base64 Decoder (UTF-8 aware). Returns null on invalid input.
function decodeBase64(str) {
    try {
        const bin = atob(String(str || '').replace(/\s/g, ''));
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
        return null;
    }
}

// Minimal HTML escape for untrusted mail text injected into our HTML template
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
