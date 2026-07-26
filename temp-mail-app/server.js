/* ==========================================================================
   Kirato Temp Mail - Express Backend & SSE Real-time Server
   ========================================================================== */

const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static frontend files
app.use(express.static(path.join(__dirname, './')));

// In-memory data store for temporary emails & active SSE connections
// Format: address -> array of email objects
const emailStore = new Map();

// Active SSE client connections: address -> Set of res objects
const sseClients = new Map();

// Helper: Broadcast mail to SSE clients for an address
function broadcastNewMail(address, mailData) {
    const cleanAddress = address.toLowerCase();
    
    // Store in memory
    if (!emailStore.has(cleanAddress)) {
        emailStore.set(cleanAddress, []);
    }
    emailStore.get(cleanAddress).unshift(mailData);

    // Broadcast to connected SSE clients
    const clients = sseClients.get(cleanAddress);
    if (clients) {
        const payload = `data: ${JSON.stringify({ type: 'NEW_EMAIL', email: mailData })}\n\n`;
        clients.forEach(res => res.write(payload));
    }
}

// --------------------------------------------------------------------------
// 1. SSE Stream Endpoint (Real-time updates)
// --------------------------------------------------------------------------
app.get('/api/stream', (req, res) => {
    const address = (req.query.address || '').toLowerCase();
    if (!address) {
        return res.status(400).send('Missing address parameter');
    }

    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Register SSE client connection
    if (!sseClients.has(address)) {
        sseClients.set(address, new Set());
    }
    sseClients.get(address).add(res);

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
    const { to, from, fromName, fromEmail, subject, text, html } = req.body;

    if (!to) {
        return res.status(400).json({ error: 'Missing "to" field' });
    }

    const mailData = {
        id: 'mail_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        to: to.toLowerCase(),
        from: from || `${fromName} <${fromEmail}>`,
        fromName: fromName || from || 'Unknown',
        fromEmail: fromEmail || from || 'unknown@domain.com',
        subject: subject || '(No Subject)',
        text: text || '',
        html: html || `<p>${text || ''}</p>`,
        snippet: (text || '').substring(0, 100),
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
    };

    broadcastNewMail(to.toLowerCase(), mailData);

    console.log(`[+] Email received for: ${to} | Subject: ${subject}`);
    res.json({ success: true, message: 'Email received and broadcasted' });
});

// --------------------------------------------------------------------------
// 3. API Get Stored Messages for Address
// --------------------------------------------------------------------------
app.get('/api/messages', (req, res) => {
    const address = (req.query.address || '').toLowerCase();
    const emails = emailStore.get(address) || [];
    res.json({ address, emails });
});

// --------------------------------------------------------------------------
// 4. Simulate Email Endpoint (Helper for testing)
// --------------------------------------------------------------------------
app.post('/api/simulate-email', (req, res) => {
    const { to, fromName, fromEmail, subject, text, html } = req.body;

    const mailData = {
        id: 'sim_' + Date.now(),
        to: (to || 'hanoi1992@kirato.com').toLowerCase(),
        fromName: fromName || 'Security Team',
        fromEmail: fromEmail || 'security@kirato.com',
        subject: subject || 'Mã xác nhận đăng ký tài khoản',
        text: text || 'Mã OTP của bạn là 992812.',
        html: html || `<div style="padding:15px; background:#f3f4f6; border-radius:8px;"><h2>Mã xác nhận: <b>992812</b></h2></div>`,
        snippet: text ? text.substring(0, 100) : 'Mã OTP của bạn là 992812.',
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
    };

    broadcastNewMail(mailData.to, mailData);
    res.json({ success: true, mail: mailData });
});

// Start Server
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 Kirato Temp Mail Server running at: http://localhost:${PORT}`);
    console.log(`📥 Webhook endpoint: http://localhost:${PORT}/api/webhook/email`);
    console.log(`==================================================`);
});

