/* ==========================================================================
   Hatoky Mail - Frontend Logic & Real-time SSE Manager
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // State management
    let state = {
        currentEmail: '',
        emails: [],
        selectedEmailId: null,
        eventSource: null
    };

    // DOM Elements
    const prefixInput = document.getElementById('prefixInput');
    const domainSelect = document.getElementById('domainSelect');
    const generateBtn = document.getElementById('generateBtn');
    const currentAddressEl = document.getElementById('currentAddress');
    const copyBtn = document.getElementById('copyBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const refreshInboxBtn = document.getElementById('refreshInboxBtn');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    
    const emailListEl = document.getElementById('emailList');
    const emptyInboxState = document.getElementById('emptyInboxState');
    const unreadBadgeEl = document.getElementById('unreadBadge');

    const readerContent = document.getElementById('readerContent');
    const emptyReaderState = document.getElementById('emptyReaderState');
    const viewSubject = document.getElementById('viewSubject');
    const viewSenderName = document.getElementById('viewSenderName');
    const viewSenderEmail = document.getElementById('viewSenderEmail');
    const viewRecipient = document.getElementById('viewRecipient');
    const viewDate = document.getElementById('viewDate');
    const viewAvatar = document.getElementById('viewAvatar');
    const mailFrame = document.getElementById('mailFrame');
    const deleteMailBtn = document.getElementById('deleteMailBtn');
    const starMailBtn = document.getElementById('starMailBtn');
    const simulateMailBtn = document.getElementById('simulateMailBtn');

    // Modal Donate Elements
    const fixedDonateBtn = document.getElementById('fixedDonateBtn');
    const donateModal = document.getElementById('donateModal');
    const closeDonateModal = document.getElementById('closeDonateModal');
    const copyBtcBtn = document.getElementById('copyBtcBtn');
    const btcAddressText = document.getElementById('btcAddressText');

    // Terms Modal Elements
    const termsLink = document.getElementById('termsLink');
    const termsModal = document.getElementById('termsModal');
    const closeTermsModal = document.getElementById('closeTermsModal');
    const agreeTermsBtn = document.getElementById('agreeTermsBtn');

    // Theme Switcher Logic
    function initTheme() {
        const savedTheme = localStorage.getItem('hatoky_theme') || localStorage.getItem('kirato_theme') || 'light';
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-theme');
            if (themeToggleBtn) themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
        } else {
            document.body.classList.remove('dark-theme');
            if (themeToggleBtn) themeToggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
        }
    }

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const isDark = document.body.classList.toggle('dark-theme');
            localStorage.setItem('hatoky_theme', isDark ? 'dark' : 'light');
            themeToggleBtn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
            showToast(isDark ? '🌙 Đã bật chế độ Tối (Dark Mode)' : '☀️ Đã bật chế độ Sáng (Light Mode)');
        });
    }

    // Modal Donate Handlers
    if (fixedDonateBtn && donateModal) {
        fixedDonateBtn.addEventListener('click', () => {
            donateModal.classList.remove('hidden');
        });
    }

    if (closeDonateModal && donateModal) {
        closeDonateModal.addEventListener('click', () => {
            donateModal.classList.add('hidden');
        });

        donateModal.addEventListener('click', (e) => {
            if (e.target === donateModal) {
                donateModal.classList.add('hidden');
            }
        });
    }

    if (copyBtcBtn && btcAddressText) {
        copyBtcBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(btcAddressText.textContent.trim());
            showToast('📋 Đã sao chép địa chỉ ví Bitcoin!');
        });
    }

    // Terms Modal Handlers
    if (termsLink && termsModal) {
        termsLink.addEventListener('click', (e) => {
            e.preventDefault();
            termsModal.classList.remove('hidden');
        });
    }

    if (closeTermsModal && termsModal) {
        closeTermsModal.addEventListener('click', () => {
            termsModal.classList.add('hidden');
        });

        termsModal.addEventListener('click', (e) => {
            if (e.target === termsModal) {
                termsModal.classList.add('hidden');
            }
        });
    }

    if (agreeTermsBtn && termsModal) {
        agreeTermsBtn.addEventListener('click', () => {
            termsModal.classList.add('hidden');
            showToast('✅ Bạn đã đồng ý với Điều khoản sử dụng!');
        });
    }

    // Helper: Toast Notifications
    function showToast(message) {
        const toastContainer = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    // Helper: RFC 2047 Header Decoder (Converts =?UTF-8?B?...?= into clear Vietnamese text)
    function decodeRFC2047(header) {
        if (!header) return '(No Subject)';
        return header.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (match, b64) => {
            try {
                return decodeURIComponent(escape(atob(b64)));
            } catch (e) {
                try { return atob(b64); } catch (err) { return match; }
            }
        }).replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (match, qp) => {
            try {
                return qp.replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/_/g, ' ');
            } catch (e) { return match; }
        });
    }

    // Helper: Strict Pure Numeric OTP Extractor (Prevents "41506Kh" or "ults" garbage strings)
    function extractOtpCode(text, subject) {
        const cleanSub = decodeRFC2047(subject || '');
        const combined = `${cleanSub} ${text || ''}`;

        // Priority 1: Keyword + Pure Digits (4 to 8 digits)
        const keywordDigitMatch = combined.match(/(?:code|mã|otp|pin|passcode|verification|verify|secret|security|confirm|confirmation|auth)[^\d]*\b(\d{4,8})\b/i);
        if (keywordDigitMatch && keywordDigitMatch[1]) {
            return keywordDigitMatch[1];
        }

        // Fallbacks require an OTP-related keyword SOMEWHERE in the mail,
        // otherwise years/order numbers/prices trigger false OTP banners
        const hasOtpKeyword = /(code|mã|otp|pin|passcode|verification|verify|xác minh|xác nhận|confirm|auth)/i.test(combined);
        if (!hasOtpKeyword) return null;

        // Priority 2: Pure 4-8 digits in Subject line (Facebook/Google/TikTok subjects put OTP first!)
        const subjectDigitMatch = cleanSub.match(/\b(\d{4,8})\b/);
        if (subjectDigitMatch) {
            return subjectDigitMatch[1];
        }

        // Priority 3: Standalone 4 to 8 digits in body
        const bodyDigitMatch = combined.match(/\b(\d{4,8})\b/);
        return bodyDigitMatch ? bodyDigitMatch[1] : null;
    }

    // Helper: Random string generator
    function generateRandomString(length = 8) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // List of reserved business/system prefixes and special accounts
    const RESERVED_PREFIXES = [
        'hung', 'info', 'contact', 'admin', 'administrator', 'support', 'sales',
        'help', 'billing', 'office', 'webmaster', 'postmaster', 'hostmaster',
        'root', 'service', 'mail', 'email', 'marketing', 'security', 'abuse',
        'privacy', 'legal', 'ceo', 'cfo', 'cto', 'manager', 'hr', 'payroll',
        'jobs', 'dev', 'api', 'test', 'demo', 'system', 'noreply', 'no-reply',
        'finance', 'payment'
    ];

    // Create or Set Active Address
    function createAddress(prefix = '') {
        const domain = domainSelect.value;
        let cleanPrefix = prefix.trim().toLowerCase();

        // Extract username if user typed full email address (e.g. hung@hatoky.xyz -> hung)
        if (cleanPrefix.includes('@')) {
            cleanPrefix = cleanPrefix.split('@')[0];
        }

        // Validate reserved business prefixes
        if (cleanPrefix && RESERVED_PREFIXES.includes(cleanPrefix)) {
            showToast(`❌ Tên "${cleanPrefix}" là địa chỉ doanh nghiệp/hệ thống, không được chọn!`);
            if (prefixInput) {
                prefixInput.focus();
                prefixInput.select();
            }
            return;
        }

        cleanPrefix = cleanPrefix || generateRandomString(9);
        state.currentEmail = `${cleanPrefix}${domain}`.toLowerCase();
        localStorage.setItem('hatoky_address', state.currentEmail);

        currentAddressEl.textContent = state.currentEmail;
        showToast(`Đã tạo địa chỉ mới: ${state.currentEmail}`);

        // Reset state
        state.emails = [];
        state.selectedEmailId = null;
        renderReader();
        renderEmailList();

        // Fetch past emails & connect Real-time SSE
        fetchExistingEmails();
        connectSSE();
    }

    // Fetch past emails for active address
    function fetchExistingEmails() {
        if (!state.currentEmail) return;
        fetch(`/api/messages?address=${encodeURIComponent(state.currentEmail)}`)
            .then(res => res.json())
            .then(data => {
                if (data && Array.isArray(data.emails)) {
                    // Server returns newest-first; addIncomingEmail unshifts,
                    // so iterate oldest-first to keep newest at the top
                    data.emails.slice().reverse().forEach(mail => {
                        if (!state.emails.some(e => e.id === mail.id)) {
                            addIncomingEmail(mail);
                        }
                    });
                }
            })
            .catch(err => console.warn('Could not fetch stored messages:', err));
    }

    // Connect Server-Sent Events (SSE) for Real-time Updates
    function connectSSE() {
        if (state.eventSource) {
            state.eventSource.close();
        }

        const sseUrl = `/api/stream?address=${encodeURIComponent(state.currentEmail)}`;
        state.eventSource = new EventSource(sseUrl);

        state.eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'NEW_EMAIL') {
                addIncomingEmail(data.email);
            }
        };

        // Connection failures surface here; the browser auto-reconnects
        state.eventSource.onerror = () => {
            console.log('SSE connection waiting or lost, will reconnect automatically.');
        };
    }

    // Add Incoming Email to List
    function addIncomingEmail(mail) {
        // Strict isolation: Only process email if target address matches active user address
        if (mail.to && state.currentEmail) {
            const cleanTo = mail.to.replace(/[<>]/g, '').trim().toLowerCase();
            const cleanCurrent = state.currentEmail.replace(/[<>]/g, '').trim().toLowerCase();
            if (cleanTo !== cleanCurrent) {
                return;
            }
        }

        const cleanSub = decodeRFC2047(mail.subject || '');
        const cleanName = decodeRFC2047(mail.fromName || mail.from?.split('<')[0] || 'Unknown');
        // Prefer the OTP the worker already extracted; fall back to local extraction
        const otp = (typeof mail.otpCode === 'string' && /^\d{4,8}$/.test(mail.otpCode))
            ? mail.otpCode
            : extractOtpCode(mail.text, cleanSub);
        const newMail = {
            id: mail.id || 'mail_' + Date.now(),
            fromName: cleanName,
            fromEmail: mail.fromEmail || mail.from || 'unknown@domain.com',
            subject: cleanSub,
            snippet: mail.snippet || mail.text?.substring(0, 100) || 'No preview available',
            html: mail.html || `<p>${mail.text || 'Empty content'}</p>`,
            date: formatMailDate(mail),
            unread: true,
            starred: false,
            otpCode: otp
        };

        state.emails.unshift(newMail);
        if (otp) {
            showToast(`🔑 Nhận được mã OTP: ${otp}`);
        } else {
            showToast(`📩 Có mail mới từ ${newMail.fromName}`);
        }
        renderEmailList();
    }

    // Render Email List
    function renderEmailList() {
        const unreadCount = state.emails.filter(e => e.unread).length;
        unreadBadgeEl.textContent = unreadCount;
        unreadBadgeEl.style.display = unreadCount > 0 ? '' : 'none';

        if (state.emails.length === 0) {
            emailListEl.innerHTML = '';
            emptyInboxState.classList.remove('hidden');
            return;
        }

        emptyInboxState.classList.add('hidden');
        emailListEl.innerHTML = state.emails.map(mail => `
            <div class="email-item ${mail.unread ? 'unread' : ''} ${state.selectedEmailId === mail.id ? 'selected' : ''}" data-id="${escapeHtml(mail.id)}" role="button" tabindex="0" aria-label="${escapeHtml(mail.subject)}">
                <div class="item-top">
                    <span class="item-sender">${escapeHtml(mail.fromName)}</span>
                    <span class="item-time">${escapeHtml(mail.date)}</span>
                </div>
                <div class="item-subject">
                    ${mail.otpCode ? `<span class="otp-badge-mini" data-otp="${mail.otpCode}" title="Bấm để sao chép mã OTP">🔑 ${mail.otpCode}</span> ` : ''}
                    ${escapeHtml(mail.subject)}
                </div>
                <div class="item-snippet">${escapeHtml(mail.snippet)}</div>
            </div>
        `).join('');

        // Attach Click + Keyboard Events to items
        document.querySelectorAll('.email-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Clicking the OTP badge copies the code without opening the mail
                const otpBadge = e.target.closest('.otp-badge-mini');
                if (otpBadge && otpBadge.dataset.otp) {
                    e.stopPropagation();
                    navigator.clipboard.writeText(otpBadge.dataset.otp);
                    showToast(`📋 Đã sao chép mã OTP: ${otpBadge.dataset.otp}`);
                    return;
                }
                selectEmail(item.getAttribute('data-id'));
            });
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectEmail(item.getAttribute('data-id'));
                }
            });
        });
    }

    // Select Email to Read
    function selectEmail(id) {
        state.selectedEmailId = id;
        const mail = state.emails.find(e => e.id === id);
        if (mail) {
            mail.unread = false;
        }
        renderEmailList();
        renderReader();
    }

    // Render Reader Panel
    function renderReader() {
        const mail = state.emails.find(e => e.id === state.selectedEmailId);

        if (!mail) {
            readerContent.classList.add('hidden');
            emptyReaderState.classList.remove('hidden');
            return;
        }

        emptyReaderState.classList.add('hidden');
        readerContent.classList.remove('hidden');

        viewSubject.textContent = mail.subject;
        viewSenderName.textContent = mail.fromName;
        viewSenderEmail.textContent = `<${mail.fromEmail}>`;
        viewRecipient.textContent = state.currentEmail;
        viewDate.textContent = mail.date;
        viewAvatar.textContent = mail.fromName.charAt(0).toUpperCase();

        starMailBtn.innerHTML = mail.starred ? 
            '<i class="fa-solid fa-star" style="color:#f59e0b;"></i>' : 
            '<i class="fa-regular fa-star"></i>';

        // Render OTP Banner if present
        let otpBannerHtml = '';
        if (mail.otpCode) {
            otpBannerHtml = `
                <div style="background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; padding: 14px 20px; border-radius: 12px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 4px 14px rgba(99,102,241,0.3);">
                    <div>
                        <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; opacity: 0.9; letter-spacing: 0.5px;">🔑 Mã xác minh (OTP Code)</div>
                        <div style="font-size: 26px; font-weight: 900; letter-spacing: 2px; margin-top: 2px;">${mail.otpCode}</div>
                    </div>
                    <button id="copyOtpBtn" style="background: #ffffff; color: #4f46e5; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
                        <i class="fa-regular fa-copy"></i> Sao chép mã
                    </button>
                </div>
            `;
        }

        // Render HTML safely inside IFrame
        const doc = mailFrame.contentDocument || mailFrame.contentWindow.document;
        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: system-ui, -apple-system, sans-serif; padding: 15px; color: #1e293b; line-height: 1.6; }
                    a { color: #6366f1; }
                </style>
            </head>
            <body>
                ${otpBannerHtml}
                ${mail.html}
            </body>
            </html>
        `);
        doc.close();

        // Attach Copy OTP listener inside iframe
        setTimeout(() => {
            const copyOtpBtn = doc.getElementById('copyOtpBtn');
            if (copyOtpBtn) {
                copyOtpBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(mail.otpCode);
                    showToast(`📋 Đã sao chép mã OTP: ${mail.otpCode}`);
                });
            }
        }, 100);
    }

    // Helper: HTML Escape
    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    // Helper: Format mail time from server timestamp (fallback: given date string)
    function formatMailDate(mail) {
        if (mail.timestamp) {
            return new Date(mail.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return mail.date || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Event Listeners
    generateBtn.addEventListener('click', () => createAddress(prefixInput.value));
    
    if (prefixInput) {
        prefixInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                createAddress(prefixInput.value);
            }
        });
    }
    
    copyBtn.addEventListener('click', () => {
        if (!state.currentEmail) {
            showToast('⚠️ Vui lòng nhập username và bấm Get Email để tạo địa chỉ!');
            if (prefixInput) prefixInput.focus();
            return;
        }
        navigator.clipboard.writeText(state.currentEmail);
        showToast('📋 Đã sao chép địa chỉ email!');
    });

    const refreshHandler = () => {
        showToast('🔄 Đã làm mới hộp thư');
        fetchExistingEmails();
        renderEmailList();
    };

    refreshBtn.addEventListener('click', refreshHandler);
    if (refreshInboxBtn) refreshInboxBtn.addEventListener('click', refreshHandler);

    deleteMailBtn.addEventListener('click', () => {
        if (!state.selectedEmailId) return;
        const deletedId = state.selectedEmailId;
        state.emails = state.emails.filter(e => e.id !== deletedId);
        state.selectedEmailId = null;
        renderEmailList();
        renderReader();
        showToast('🗑️ Đã xóa email');
        // Also delete on server so it doesn't reappear on refresh
        fetch(`/api/messages?address=${encodeURIComponent(state.currentEmail)}&id=${encodeURIComponent(deletedId)}`, {
            method: 'DELETE'
        }).catch(() => {});
    });

    // Clear the whole inbox (client + server)
    const clearInboxBtn = document.getElementById('clearInboxBtn');
    if (clearInboxBtn) {
        clearInboxBtn.addEventListener('click', () => {
            if (!state.currentEmail || state.emails.length === 0) {
                showToast('📭 Hộp thư đang trống');
                return;
            }
            state.emails = [];
            state.selectedEmailId = null;
            renderEmailList();
            renderReader();
            showToast('🧹 Đã xóa toàn bộ hộp thư');
            fetch(`/api/messages?address=${encodeURIComponent(state.currentEmail)}`, {
                method: 'DELETE'
            }).catch(() => {});
        });
    }

    starMailBtn.addEventListener('click', () => {
        const mail = state.emails.find(e => e.id === state.selectedEmailId);
        if (mail) {
            mail.starred = !mail.starred;
            renderReader();
            renderEmailList();
        }
    });

    // Simulate Receiving Email with OTP (Frontend Test)
    simulateMailBtn.addEventListener('click', () => {
        if (!state.currentEmail) {
            showToast('⚠️ Vui lòng nhập username và bấm Get Email trước!');
            if (prefixInput) prefixInput.focus();
            return;
        }
        const senders = [
            { name: 'Google Security', email: 'no-reply@accounts.google.com', subject: 'Mã xác minh Google của bạn: 849201', code: '849201' },
            { name: 'Facebook Team', email: 'security@facebookmail.com', subject: '392812 là mã khôi phục mật khẩu Facebook của bạn', code: '392812' },
            { name: 'TikTok Auth', email: 'verify@tiktok.com', subject: '[TikTok] Your verification code is 591024', code: '591024' },
            { name: 'Discord App', email: 'noreply@discord.com', subject: 'Discord Security Code: 712940', code: '712940' }
        ];
        const randomSender = senders[Math.floor(Math.random() * senders.length)];

        fetch('/api/simulate-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: state.currentEmail,
                fromName: randomSender.name,
                fromEmail: randomSender.email,
                subject: randomSender.subject,
                text: `Xin chào,\n\nĐây là email từ ${randomSender.name}.\nMã xác nhận OTP của bạn là: ${randomSender.code}.\n\nTrân trọng!`,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                        <h2 style="color: #6366f1;">${randomSender.subject}</h2>
                        <p>Xin chào anh,</p>
                        <p>Dịch vụ gửi mã xác nhận đến địa chỉ <strong>${state.currentEmail}</strong>.</p>
                        <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; font-size: 24px; font-weight: bold; text-align: center; color: #4338ca;">
                            Mã xác minh: ${randomSender.code}
                        </div>
                        <p style="margin-top: 20px; font-size: 12px; color: #64748b;">Trang web email tạm thời Hatoky Mail.</p>
                    </div>
                `
            })
        }).then(res => {
            // fetch only rejects on network failure; treat HTTP errors the same
            if (res && !res.ok) throw new Error('HTTP ' + res.status);
        }).catch(() => {
            // Offline/static fallback: add the simulated mail locally
            addIncomingEmail({
                fromName: randomSender.name,
                fromEmail: randomSender.email,
                subject: randomSender.subject,
                text: `Mã xác nhận OTP: ${randomSender.code}`,
                html: `<p>Mã xác minh của bạn: <b>${randomSender.code}</b></p>`
            });
        });
    });

    // Compose Window Logic
    const openComposeBtn = document.getElementById('openComposeBtn');
    const composeWindow = document.getElementById('composeWindow');
    const closeComposeBtn = document.getElementById('closeComposeBtn');
    const minComposeBtn = document.getElementById('minComposeBtn');
    const sendEmailBtn = document.getElementById('sendEmailBtn');
    const discardComposeBtn = document.getElementById('discardComposeBtn');
    const composeToInput = document.getElementById('composeToInput');
    const composeSubjectInput = document.getElementById('composeSubjectInput');
    const composeMessageArea = document.getElementById('composeMessageArea');

    if (openComposeBtn && composeWindow) {
        openComposeBtn.addEventListener('click', () => {
            if (!state.currentEmail) {
                showToast('⚠️ Vui lòng nhập username và bấm Get Email trước!');
                if (prefixInput) prefixInput.focus();
                return;
            }
            composeWindow.classList.remove('hidden');
            composeWindow.classList.remove('minimized');
            if (composeToInput) composeToInput.focus();
            showToast('✍️ Đã mở cửa sổ Soạn thư (Compose)');
        });
    }

    if (closeComposeBtn && composeWindow) {
        closeComposeBtn.addEventListener('click', () => {
            composeWindow.classList.add('hidden');
        });
    }

    if (minComposeBtn && composeWindow) {
        minComposeBtn.addEventListener('click', () => {
            composeWindow.classList.toggle('minimized');
        });
    }

    if (discardComposeBtn && composeWindow) {
        discardComposeBtn.addEventListener('click', () => {
            if (composeToInput) composeToInput.value = '';
            if (composeSubjectInput) composeSubjectInput.value = '';
            if (composeMessageArea) composeMessageArea.innerHTML = '';
            composeWindow.classList.add('hidden');
            showToast('🗑️ Đã hủy bản nháp');
        });
    }

    if (sendEmailBtn && composeWindow) {
        sendEmailBtn.addEventListener('click', () => {
            const recipient = composeToInput ? composeToInput.value.trim() : '';
            
            if (!recipient) {
                showToast('⚠️ Vui lòng nhập địa chỉ email người nhận (To)');
                if (composeToInput) composeToInput.focus();
                return;
            }

            // Honest UX: temp mail is receive-only, there is no outgoing SMTP
            showToast('⚠️ Email tạm thời chỉ NHẬN thư — tính năng gửi đi chưa được hỗ trợ.');
        });
    }

    // Escape key closes any open modal / the compose window
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (donateModal) donateModal.classList.add('hidden');
        if (termsModal) termsModal.classList.add('hidden');
        if (composeWindow) composeWindow.classList.add('hidden');
    });

    // Restore previously used address after reload (server keeps mail within TTL)
    function restoreSavedAddress() {
        const saved = (localStorage.getItem('hatoky_address') || '').toLowerCase();
        if (!saved.includes('@')) return;
        state.currentEmail = saved;
        currentAddressEl.textContent = saved;
        fetchExistingEmails();
        connectSSE();
        showToast(`📮 Đã khôi phục địa chỉ: ${saved}`);
    }

    // Initialize (do not auto-generate a new address on load)
    initTheme();
    restoreSavedAddress();
});
