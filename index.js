const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { authenticator } = require('otplib');

// ========== কনফিগ ==========
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const FB_URL = process.env.FB_URL || 'https://tafsir-bot-7983f-default-rtdb.asia-southeast1.firebasedatabase.app/bot';
const CHANNELS = (process.env.CHANNELS || '@earnify_beckup,@earnxotp').split(',');
const ADMIN_LINK = process.env.ADMIN_LINK || 'https://t.me/Tafsirs_bot';
const BOT_LINK = process.env.BOT_LINK || 'https://t.me/EarnxNumber_bot';
const DV_LINK = process.env.DV_LINK || 'https://t.me/Mhnirob1';
const CN_LINK = process.env.CN_LINK || 'https://t.me/earnify_beckup';

const app = express();
app.use(cors());
app.use(express.json());

const userState = {};
let botInfo = {};
const activeNumbers = {};

// ========== সার্ভার স্টার্ট ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    botInfo = await bot.getMe();
    console.log(`Bot @${botInfo.username} running on port ${PORT}`);
    // আগের একটিভ নাম্বার রিস্টোর
    try {
        const usersRes = await axios.get(`${FB_URL}/users.json`);
        if (usersRes.data) {
            const now = Date.now();
            for (const [userId, userData] of Object.entries(usersRes.data)) {
                const storeg = userData['user-local-storeg'];
                if (storeg && storeg.state === 'numbers' && storeg.numbers && (now - storeg.time < 24*60*60*1000)) {
                    storeg.numbers.forEach(num => {
                        activeNumbers[num] = {
                            chatId: userId,
                            time: storeg.time,
                            lastMessage: storeg.lastMessages ? storeg.lastMessages[num] : ""
                        };
                    });
                }
            }
        }
        console.log("Active numbers restored from DB");
    } catch(e) { console.log("DB restore error", e.message); }
});

// ========== হেল্পার ==========
async function checkMembership(userId) {
    for (let ch of CHANNELS) {
        try {
            const m = await bot.getChatMember(ch, userId);
            if (m.status === 'left' || m.status === 'kicked') return false;
        } catch { return false; }
    }
    return true;
}

async function getUserInfo(userId, msg, referrerId = null) {
    try {
        let res = await axios.get(`${FB_URL}/users/${userId}.json`);
        let user = res.data;
        if (!user) {
            user = {
                username: msg.from?.username || "NoUser",
                chat_id: userId,
                name: msg.from?.first_name || "User",
                balance: 0,
                refer_code: `ref_${userId}`,
                referred_by: referrerId || "none",
                total_referrals: 0,
                referral_rewarded: false
            };
            await axios.put(`${FB_URL}/users/${userId}.json`, user);
        }
        return user;
    } catch(e) { return null; }
}

const bottomKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: "📱 Get Number" }, { text: "💰 Balance" }],
            [{ text: "💸 Withdraw" }, { text: "📊 Status" }],
            [{ text: "🔐 Get 2FA Code" }]
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

// ========== টেলিগ্রাম মেনু ==========
bot.onText(/^\/start(?: (.*))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const param = match[1] ? match[1].trim() : '';
    let referrerId = param.startsWith('ref_') ? param.split('_')[1] : null;
    await getUserInfo(chatId, msg, referrerId);
    if (!await checkMembership(chatId)) {
        const kb = [[{ text: "📢 Main Channel", url: "https://t.me/earnify_beckup" }],
                    [{ text: "💬 OTP Group", url: "https://t.me/earnxotp" }],
                    [{ text: "✅ Verify", callback_data: "verify" }]];
        return bot.sendMessage(chatId, "⚠️ চ্যানেল জয়েন করুন ও Verify ক্লিক করুন", { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    }
    bot.sendMessage(chatId, `🤖 <b>Welcome ${msg.from.first_name}!</b>\n🟢 Main Menu`, { parse_mode: 'HTML', ...bottomKeyboard });
});

// ========== অটো এসএমএস চেকার (প্রতি ৩ সেকেন্ড) ==========
setInterval(async () => {
    const numbers = Object.keys(activeNumbers);
    if (numbers.length === 0) return;
    const retRes = await axios.get(`${FB_URL}/settings/ret.json`).catch(() => ({ data: 0.25 }));
    const smsRate = retRes.data !== null ? Number(retRes.data) : 0.25;
    for (const phone of numbers) {
        const trackData = activeNumbers[phone];
        const now = Date.now();
        // ২৪ ঘণ্টা পর সেশন এক্সপায়ার
        if (now - trackData.time > 24 * 60 * 60 * 1000) {
            delete activeNumbers[phone];
            continue;
        }
        try {
            const res = await axios.get(`${FB_URL}/sms_logs/${phone}.json`);
            if (res.data && res.data.message) {
                const currentMsg = res.data.message;
                if (currentMsg !== trackData.lastMessage) {
                    const isUpdate = trackData.lastMessage !== undefined && trackData.lastMessage !== "";
                    trackData.lastMessage = currentMsg;
                    await axios.patch(`${FB_URL}/users/${trackData.chatId}/user-local-storeg/lastMessages.json`, { [phone]: currentMsg }).catch(()=>{});
                    const otpMatch = currentMsg.match(/\b(\d{3,4}[ -]?\d{3,4}|\d{4,8})\b/);
                    const otp = otpMatch ? otpMatch[0] : "";
                    let reportTxt = `${isUpdate ? "🔄 UPDATE" : "🛎️ NEW"} MESSAGE\n<code>${phone}</code>\n<blockquote>${currentMsg}</blockquote>\n`;
                    let otpButtons = [];
                    if (otp) {
                        otpButtons.push([{ text: `${otp}`, copy_text: { text: otp } }]);
                        if (!res.data.paid) {
                            try {
                                let uRes = await axios.get(`${FB_URL}/users/${trackData.chatId}.json`);
                                if (uRes.data) {
                                    let newBal = (Number(uRes.data.balance) || 0) + smsRate;
                                    await axios.patch(`${FB_URL}/users/${trackData.chatId}.json`, { balance: newBal });
                                    reportTxt += `🎁 Bonus: +${smsRate} BDT\n`;
                                }
                                await axios.patch(`${FB_URL}/sms_logs/${phone}.json`, { paid: true });
                            } catch(e) {}
                        }
                    }
                    bot.sendMessage(trackData.chatId, reportTxt, { parse_mode: 'HTML', reply_markup: { inline_keyboard: otpButtons } });
                }
            }
        } catch(e) {}
    }
}, 3000);

// ========== অন্যান্য মেনু হ্যান্ডলার (Get Number, Balance, Withdraw ইত্যাদি) ==========
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    // 2FA সিক্রেট চেক
    const isBase32 = /^[A-Z2-7]{16,64}$/.test(text.toUpperCase().replace(/\s+/g, ''));
    if (isBase32) {
        try {
            const code = authenticator.generate(text);
            const msgText = `🔐 2FA Code: <code>${code}</code>\nValidity: 30 sec\nAdmin: @mhnirob1`;
            return bot.sendMessage(chatId, msgText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: `📋 Copy ${code}`, copy_text: { text: code } }]] } });
        } catch(e) {}
    }
    const menuCommands = ['📱 Get Number', '💰 Balance', '💸 Withdraw', '📊 Status', '🔐 Get 2FA Code'];
    if (menuCommands.includes(text)) delete userState[chatId];
    if (!await checkMembership(chatId)) return bot.sendMessage(chatId, "❌ চ্যানেল জয়েন করুন /start");

    if (text === '📱 Get Number') {
        let uRes = await axios.get(`${FB_URL}/users/${chatId}/user-local-storeg.json`);
        let storeg = uRes.data;
        if (storeg && storeg.state === 'numbers' && storeg.numbers && storeg.numbers.length > 0 && (Date.now() - (storeg.time||0) < 60*60*1000)) {
            let srv = storeg.srv, batch = storeg.numbers;
            let txt = `🔄 Restored Numbers (${srv.toUpperCase()})\n`;
            let kb = [];
            batch.forEach(num => {
                kb.push([{ text: `📋 ${num}`, copy_text: { text: num } }]);
                if(!activeNumbers[num]) activeNumbers[num] = { chatId, time: storeg.time, lastMessage: storeg.lastMessages?.[num] || "" };
            });
            kb.push([{ text: "🌍 Change Country", callback_data: "get_country" }, { text: "OTP GROUP", url: "https://t.me/earnxotp" }]);
            kb.push([{ text: "🔄 Change Number", callback_data: `next_${srv}` }]);
            txt += "⏳ Auto checking OTP...";
            return bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
        }
        const res = await axios.get(`${FB_URL}/servers.json`);
        let kb = [];
        for (let s in res.data) kb.push([{ text: ` ${s.toUpperCase()}`, callback_data: `srv_${s}` }]);
        return bot.sendMessage(chatId, "🌐 Select country:", { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    }
    else if (text === '💰 Balance') {
        const u = await getUserInfo(chatId, msg);
        const refLink = `https://t.me/${botInfo.username}?start=ref_${chatId}`;
        const txt = `💰 Balance: ${u.balance} BDT\n🔗 Referral: <code>${refLink}</code>\n👥 Refs: ${u.total_referrals}\n🎁 Per Refer: 0.05 BDT`;
        return bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "📋 Copy Link", copy_text: { text: refLink } }]] } });
    }
    else if (text === '💸 Withdraw') {
        const kb = [[{text: "bKash", callback_data: "wd_bkash"}, {text: "Nagad", callback_data: "wd_nagad"}], [{text: "Rocket", callback_data: "wd_rocket"}]];
        return bot.sendMessage(chatId, "Select withdraw method:", { parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } });
    }
    else if (text === '📊 Status') {
        const res = await axios.get(`${FB_URL}/withdrawals.json`);
        let wHistory = "";
        for (let key in res.data) {
            if (res.data[key].user_id == chatId) {
                let w = res.data[key];
                wHistory += `💸 ${w.method} | ${w.amount} BDT\n📱 ${w.account}\nStatus: ${w.status}\n━━━━━━━━━\n`;
            }
        }
        if (!wHistory) wHistory = "❌ No history";
        return bot.sendMessage(chatId, `🕜 Withdraw History:\n${wHistory}`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: "🗑️ Clear History", callback_data: "clear_history" }]] } });
    }
    else if (text === '🔐 Get 2FA Code') {
        return bot.sendMessage(chatId, "Send your 2FA Secret Key (Base32):", { parse_mode: 'HTML' });
    }

    // উইথড্র স্টেট
    if (userState[chatId]) {
        if (userState[chatId].step === 'wait_number') {
            if (!/^\d{11}$/.test(text)) return bot.sendMessage(chatId, "❌ 11 digit number needed");
            userState[chatId].account = text;
            userState[chatId].step = 'wait_amount';
            return bot.sendMessage(chatId, "💰 Enter amount (min 50 BDT):", {parse_mode:'HTML'});
        } else if (userState[chatId].step === 'wait_amount') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount < 50) return bot.sendMessage(chatId, "❌ Min 50 BDT");
            const u = await getUserInfo(chatId, msg);
            if (Number(u.balance) < amount) {
                delete userState[chatId];
                return bot.sendMessage(chatId, `❌ Insufficient balance: ${u.balance} BDT`, {parse_mode:'HTML'});
            }
            u.balance = Number(u.balance) - amount;
            await axios.patch(`${FB_URL}/users/${chatId}.json`, { balance: u.balance });
            const wdData = { user_id: chatId, method: userState[chatId].method.toUpperCase(), account: userState[chatId].account, amount, status: "Pending", time: new Date().toLocaleString("bn-BD", {timeZone: "Asia/Dhaka"}) };
            await axios.post(`${FB_URL}/withdrawals.json`, wdData);
            delete userState[chatId];
            return bot.sendMessage(chatId, `✅ Withdraw request sent!\nAmount: ${amount} BDT\nAccount: ${wdData.account}`, {parse_mode:'HTML'});
        }
    }
});

// ========== ইনলাইন কলব্যাক হ্যান্ডলার ==========
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const msgId = q.message.message_id;
    const data = q.data;
    if (!await checkMembership(chatId)) {
        if (data === 'verify') return bot.answerCallbackQuery(q.id, { text: "Join channel first!", show_alert: true });
        else return bot.answerCallbackQuery(q.id, { text: "You left channel", show_alert: true });
    }
    bot.answerCallbackQuery(q.id).catch(()=>{});
    if (data === 'verify') {
        await bot.editMessageText("✅ Verified!", { chat_id: chatId, message_id: msgId }).catch(()=>{});
        bot.sendMessage(chatId, "🟢 Main Menu", { ...bottomKeyboard });
        try {
            let uRes = await axios.get(`${FB_URL}/users/${chatId}.json`);
            let currentUser = uRes.data;
            if (currentUser && currentUser.referred_by && currentUser.referred_by !== "none" && !currentUser.referral_rewarded) {
                let refId = currentUser.referred_by;
                let refUserRes = await axios.get(`${FB_URL}/users/${refId}.json`);
                if (refUserRes.data) {
                    await axios.patch(`${FB_URL}/users/${refId}.json`, { balance: (Number(refUserRes.data.balance)||0)+0.05, total_referrals: (Number(refUserRes.data.total_referrals)||0)+1 });
                    bot.sendMessage(refId, `🎉 New referral! +0.05 BDT`, {parse_mode:'HTML'}).catch(()=>{});
                    await axios.patch(`${FB_URL}/users/${chatId}.json`, { referral_rewarded: true });
                }
            }
        } catch(err) {}
    } else if (data === 'clear_history') {
        const res = await axios.get(`${FB_URL}/withdrawals.json`);
        if (res.data) for (let key in res.data) if (res.data[key].user_id == chatId) await axios.delete(`${FB_URL}/withdrawals/${key}.json`);
        bot.editMessageText("History cleared!", { chat_id: chatId, message_id: msgId }).catch(()=>{});
    } else if (data.startsWith('wd_')) {
        const method = data.split('_')[1];
        userState[chatId] = { step: 'wait_number', method };
        bot.sendMessage(chatId, `Enter 11-digit ${method.toUpperCase()} number:`);
    } else if (data.startsWith('srv_') || data.startsWith('next_')) {
        let srv = data.split('_')[1];
        const res = await axios.get(`${FB_URL}/servers/${encodeURIComponent(srv)}.json`);
        let allNumbers = res.data || [];
        if (!Array.isArray(allNumbers)) allNumbers = Object.values(allNumbers).filter(n=>n);
        allNumbers = allNumbers.filter(n=>n);
        if (allNumbers.length === 0) return bot.sendMessage(chatId, "❌ No numbers left");
        const batch = allNumbers.splice(0, 3);
        await axios.put(`${FB_URL}/servers/${encodeURIComponent(srv)}.json`, allNumbers);
        const storegData = { state: 'numbers', srv, numbers: batch, time: Date.now(), lastMessages: {} };
        await axios.put(`${FB_URL}/users/${chatId}/user-local-storeg.json`, storegData);
        let txt = `⚡ New Numbers (${srv.toUpperCase()})\n`;
        let kb = [];
        batch.forEach(num => {
            kb.push([{ text: `📋 ${num}`, copy_text: { text: num } }]);
            activeNumbers[num] = { chatId, time: Date.now(), lastMessage: "" };
        });
        kb.push([{ text: "🌍 Change Country", callback_data: "get_country" }, { text: "OTP GROUP", url: "https://t.me/earnxotp" }]);
        kb.push([{ text: "🔄 Change Number", callback_data: `next_${srv}` }]);
        txt += "⏳ Monitoring OTP...";
        bot.editMessageText(txt, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(()=>{});
    } else if (data === 'get_country') {
        await axios.patch(`${FB_URL}/users/${chatId}.json`, { 'user-local-storeg': { state: 'country_list', time: Date.now() } });
        const res = await axios.get(`${FB_URL}/servers.json`);
        let kb = [];
        for (let s in res.data) kb.push([{ text: ` ${s.toUpperCase()}`, callback_data: `srv_${s}` }]);
        bot.editMessageText("🌐 Select country:", { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: { inline_keyboard: kb } }).catch(()=>{});
    }
});

// ========== হেলথ চেক এন্ডপয়েন্ট (Render এর জন্য) ==========
app.get('/', (req, res) => res.send("EARNX Number Bot is running"));
console.log("Node.js bot started");
