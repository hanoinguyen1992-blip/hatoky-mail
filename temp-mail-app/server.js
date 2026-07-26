/* ==========================================================================
   Hatoky Temp Mail - Express Backend & SSE Real-time Server
   ========================================================================== */

const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Optional shared secret between Cloudflare Worker and this server.
// If WEBHOOK_SECRET is set, the webhook requires header: x-webhook-secret
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

// Retention / memory-safety limits
const EMAIL_TTL_MS = 60 * 60 * 1000;      // emails auto-delete after 60 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // prune expired emails every 5 minutes
const MAX_EMAILS_PER_ADDRESS = 50;         // newest emails win
const MAX_ADDRESSES = 1000;                // least-recently-active address evicted
const MAX_SUBJECT_LEN = 500;
const MAX_TEXT_LEN = 100_000;
const MAX_HTML_LEN = 500_000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Static frontend: only expose UI files, not server source / configs
const FRONTEND_FILES = ['index.html', 'styles.css', 'app.js'];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
FRONTEND_FILES.forEach(file => {
    app.get('/' + file, (req, res) => res.sendFile(path.join(__dirname, file)));
});

// In-memory data store for temporary emails
// Format: address -> { emails: [...], lastActivity: timestamp }
const emailStore = new Map();

// Active SSE client connections: address -> Set of res objects
const sseClients = new Map();

function getMailbox(address) {
    let box = emailStore.get(address);
    if (!box) {
        // Evict the least-recently-active address when at capacity
        if (emailStore.size >= MAX_ADDRESSES) {
            let oldestKey = null;
            let oldestActivity = Infinity;
            for (const [key, value] of emailStore) {
                if (value.lastActivity < oldestActivity) {
                    oldestActivity = value.lastActivity;
                    oldestKey = key;
                }
            }
            if (oldestKey) emailStore.delete(oldestKey);
        }
        box = { emails: [], lastActivity: Date.now() };
        emailStore.set(address, box);
    }
    return box;
}

// Periodic cleanup: drop expired emails and empty mailboxes (the advertised "auto-delete")
setInterval(() => {
    const cutoff = Date.now() - EMAIL_TTL_MS;
    for (const [address, box] of emailStore) {
        box.emails = box.emails.filter(mail => (mail.timestamp || 0) > cutoff);
        if (box.emails.length === 0 && !sseClients.has(address)) {
            emailStore.delete(address);
        }
    }
}, CLEANUP_INTERVAL_MS).unref();

// Helper: Broadcast mail to SSE clients for an address
function broadcastNewMail(address, mailData) {
    const cleanAddress = address.toLowerCase();

    const box = getMailbox(cleanAddress);
    box.emails.unshift(mailData);
    box.emails.length = Math.min(box.emails.length, MAX_EMAILS_PER_ADDRESS);
    box.lastActivity = Date.now();

    // Broadcast to connected SSE clients
    const clients = sseClients.get(cleanAddress);
    if (clients) {
        const payload = `data: ${JSON.stringify({ type: 'NEW_EMAIL', email: mailData })}\n\n`;
        clients.forEach(res => {
            try { res.write(payload); } catch (e) { /* client already gone */ }
        });
    }
}

function isValidAddress(address) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

function clip(value, maxLen) {
    return typeof value === 'string' ? value.slice(0, maxLen) : '';
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// --------------------------------------------------------------------------
// 1. SSE Stream Endpoint (Real-time updates)
// --------------------------------------------------------------------------
app.get('/api/stream', (req, res) => {
    const address = String(req.query.address || '').toLowerCase();
    if (!address) {
        return res.status(400).send('Missing address parameter');
    }

    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Cap concurrent SSE connections (per address and globally)
    const totalClients = [...sseClients.values()].reduce((sum, set) => sum + set.size, 0);
    const addressClients = sseClients.get(address)?.size || 0;
    if (addressClients >= 5 || totalClients >= 500) {
        return res.end();
    }

    // Register SSE client connection
    if (!sseClients.has(address)) {
        sseClients.set(address, new Set());
    }
    sseClients.get(address).add(res);
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', address })}\n\n`);

    // Send heartbeat keep-alive every 20 seconds
    const keepAliveInterval = setInterval(() => {
        res.write(': keepalive\n\n');
    }, 20000);

    // Clean up on disconnect
    req.on('close', () => {
        clearInterval(keepAliveInterval);
        const clients = sseClients.get(address);
        if (clients) {
            clients.delete(res);
            if (clients.size === 0) {
                sseClients.delete(address);
            }
        }
    });
});

// --------------------------------------------------------------------------
// 2. Webhook Endpoint for Cloudflare Worker or Mail Server
// --------------------------------------------------------------------------
app.post('/api/webhook/email', (req, res) => {
    if (WEBHOOK_SECRET && req.get('x-webhook-secret') !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const { to, from, fromName, fromEmail, subject, text, html, otpCode } = req.body || {};

    if (!to || typeof to !== 'string') {
        return res.status(400).json({ error: 'Missing "to" field' });
    }
    const cleanTo = to.replace(/[<>]/g, '').trim().toLowerCase();
    if (!isValidAddress(cleanTo)) {
        return res.status(400).json({ error: 'Invalid "to" address' });
    }

    const now = Date.now();
    const resolvedFrom = clip(from, 200) || (fromEmail ? `${clip(fromName, 100)} <${clip(fromEmail, 200)}>`.trim() : 'unknown@sender');
    const clippedText = clip(text, MAX_TEXT_LEN);
    const mailData = {
        id: 'mail_' + now + '_' + Math.random().toString(36).slice(2, 6),
        to: cleanTo,
        from: resolvedFrom,
        fromName: clip(fromName, 100) || resolvedFrom,
        fromEmail: clip(fromEmail, 200) || clip(from, 200) || 'unknown@sender',
        subject: clip(subject, MAX_SUBJECT_LEN) || '(No Subject)',
        text: clippedText,
        html: clip(html, MAX_HTML_LEN) || `<p>${escapeHtml(clippedText)}</p>`,
        snippet: clippedText.substring(0, 100),
        otpCode: (typeof otpCode === 'string' && /^\d{4,8}$/.test(otpCode)) ? otpCode : undefined,
        date: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: now
    };

    broadcastNewMail(cleanTo, mailData);

    // Do not log subjects — they often contain the OTP itself
    console.log(`[+] Email received for: ${cleanTo}`);
    res.json({ success: true, message: 'Email received and broadcasted' });
});

// --------------------------------------------------------------------------
// 3. API Get Stored Messages for Address
// --------------------------------------------------------------------------
app.get('/api/messages', (req, res) => {
    const address = String(req.query.address || '').toLowerCase();
    const box = emailStore.get(address);
    if (box) box.lastActivity = Date.now();
    res.json({ address, ttlMinutes: EMAIL_TTL_MS / 60000, emails: box ? box.emails : [] });
});

// --------------------------------------------------------------------------
// 4. API Delete Messages (one by id, or the whole inbox)
// --------------------------------------------------------------------------
app.delete('/api/messages', (req, res) => {
    const address = String(req.query.address || '').toLowerCase();
    const id = req.query.id ? String(req.query.id) : null;
    if (!address) {
        return res.status(400).json({ error: 'Missing address parameter' });
    }

    const box = emailStore.get(address);
    if (!box) {
        return res.json({ success: true, deleted: 0 });
    }

    let deleted;
    if (id) {
        const before = box.emails.length;
        box.emails = box.emails.filter(mail => mail.id !== id);
        deleted = before - box.emails.length;
    } else {
        deleted = box.emails.length;
        box.emails = [];
    }
    box.lastActivity = Date.now();
    res.json({ success: true, deleted });
});

// --------------------------------------------------------------------------
// 5. Simulate Email Endpoint (Helper for testing)
// --------------------------------------------------------------------------
app.post('/api/simulate-email', (req, res) => {
    // Set DISABLE_SIMULATE=1 in production to turn this test helper off
    if (process.env.DISABLE_SIMULATE) {
        return res.status(403).json({ error: 'Simulate endpoint is disabled' });
    }
    const { to, fromName, fromEmail, subject, text, html } = req.body || {};

    const now = Date.now();
    const bodyText = clip(text, MAX_TEXT_LEN) || 'Mã OTP của bạn là 992812.';
    const mailData = {
        id: 'sim_' + now,
        to: String(to || 'demo@hatoky.xyz').toLowerCase(),
        fromName: fromName || 'Security Team',
        fromEmail: fromEmail || 'security@hatoky.xyz',
        subject: clip(subject, MAX_SUBJECT_LEN) || 'Mã xác nhận đăng ký tài khoản',
        text: bodyText,
        html: clip(html, MAX_HTML_LEN) || `<div style="padding:15px; background:#f3f4f6; border-radius:8px;"><h2>Mã xác nhận: <b>992812</b></h2></div>`,
        snippet: bodyText.substring(0, 100),
        date: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: now
    };

    broadcastNewMail(mailData.to, mailData);
    res.json({ success: true, mail: mailData });
});

// --------------------------------------------------------------------------
// 6. Health check (for Render/Railway deploy monitors)
// --------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', addresses: emailStore.size, uptime: process.uptime() });
});

// Unknown API route -> JSON 404 (instead of HTML error page)
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Central error handler
app.use((err, req, res, next) => {
    console.error('[Server Error]:', err.message);
    res.status(err.status || 500).json({ error: 'Internal server error' });
});

// Start Server
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 Hatoky Temp Mail Server running at: http://localhost:${PORT}`);
    console.log(`📥 Webhook endpoint: http://localhost:${PORT}/api/webhook/email`);
    console.log(`🧹 Auto-delete: emails expire after ${EMAIL_TTL_MS / 60000} minutes`);
    console.log(`==================================================`);
});
