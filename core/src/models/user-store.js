const fs = require('fs');
const path = require('path');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const crypto = require('crypto');

const USERS_FILE = getDataFile('users.json');
const CARDS_FILE = getDataFile('cards.json');
const LOGIN_ATTEMPTS_FILE = getDataFile('login-attempts.json');
const CARD_CLAIM_FILE = getDataFile('card-claim.json');
const LOGIN_LOGS_FILE = getDataFile('login-logs.json');

const LOGIN_LOG_LIMIT = 1000;

const DEFAULT_ACCOUNT_LIMIT = 2;

let cardClaimEnabled = false;
let cardClaimRecords = [];

const SALT_LENGTH = 32;
const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000;
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 10;

let loginAttempts = {};

function loadLoginAttempts() {
    try {
        ensureDataDir();
        if (fs.existsSync(LOGIN_ATTEMPTS_FILE)) {
            const data = JSON.parse(fs.readFileSync(LOGIN_ATTEMPTS_FILE, 'utf8'));
            loginAttempts = data || {};
        }
        // eslint-disable-next-line unused-imports/no-unused-vars
    } catch (e) {
        loginAttempts = {};
    }
}

function saveLoginAttempts() {
    try {
        ensureDataDir();
        fs.writeFileSync(LOGIN_ATTEMPTS_FILE, JSON.stringify(loginAttempts, null, 2), 'utf8');
    } catch (e) {
        console.error('保存登录尝试记录失败:', e.message);
    }
}

function cleanExpiredAttempts() {
    const now = Date.now();
    let cleaned = false;
    
    for (const key of Object.keys(loginAttempts)) {
        const attempt = loginAttempts[key];
        if (attempt.lockedUntil && attempt.lockedUntil < now) {
            delete loginAttempts[key];
            cleaned = true;
        } else if (attempt.windowStart && (now - attempt.windowStart) > RATE_LIMIT_WINDOW) {
            delete loginAttempts[key];
            cleaned = true;
        }
    }
    
    if (cleaned) saveLoginAttempts();
}

function checkRateLimit(ip) {
    cleanExpiredAttempts();
    const ipKey = `ip:${ip}`;
    const now = Date.now();
    
    if (!loginAttempts[ipKey]) {
        loginAttempts[ipKey] = { count: 1, windowStart: now };
        saveLoginAttempts();
        return { allowed: true };
    }
    
    const attempt = loginAttempts[ipKey];
    
    if (now - attempt.windowStart > RATE_LIMIT_WINDOW) {
        loginAttempts[ipKey] = { count: 1, windowStart: now };
        saveLoginAttempts();
        return { allowed: true };
    }
    
    if (attempt.count >= MAX_ATTEMPTS_PER_IP) {
        const remainingMs = RATE_LIMIT_WINDOW - (now - attempt.windowStart);
        return { 
            allowed: false, 
            remainingMs,
            message: `请求过于频繁，请 ${Math.ceil(remainingMs / 1000)} 秒后重试`
        };
    }
    
    attempt.count++;
    saveLoginAttempts();
    return { allowed: true };
}

function checkAccountLockout(username) {
    cleanExpiredAttempts();
    const userKey = `user:${username}`;
    const now = Date.now();
    
    if (loginAttempts[userKey] && loginAttempts[userKey].lockedUntil) {
        if (loginAttempts[userKey].lockedUntil > now) {
            const remainingMs = loginAttempts[userKey].lockedUntil - now;
            return {
                locked: true,
                remainingMs,
                message: `账户已被锁定，请 ${Math.ceil(remainingMs / 1000 / 60)} 分钟后重试`
            };
        } else {
            delete loginAttempts[userKey];
            saveLoginAttempts();
        }
    }
    
    return { locked: false };
}

function recordFailedAttempt(username) {
    const userKey = `user:${username}`;
    const now = Date.now();
    
    if (!loginAttempts[userKey]) {
        loginAttempts[userKey] = { count: 1, firstAttempt: now };
    } else {
        loginAttempts[userKey].count++;
        loginAttempts[userKey].lastAttempt = now;
    }
    
    if (loginAttempts[userKey].count >= MAX_LOGIN_ATTEMPTS) {
        loginAttempts[userKey].lockedUntil = now + LOCKOUT_DURATION;
        saveLoginAttempts();
        return {
            locked: true,
            message: `登录失败次数过多，账户已被锁定 ${LOCKOUT_DURATION / 60000} 分钟`
        };
    }
    
    saveLoginAttempts();
    return {
        locked: false,
        remainingAttempts: MAX_LOGIN_ATTEMPTS - loginAttempts[userKey].count
    };
}

function clearFailedAttempts(username) {
    const userKey = `user:${username}`;
    if (loginAttempts[userKey]) {
        delete loginAttempts[userKey];
        saveLoginAttempts();
    }
}

function validatePasswordStrength(password) {
    const value = String(password || '');
    const errors = [];
    if (value.length < 6) errors.push('密码长度至少 6 位');
    if (value.length > 128) errors.push('密码长度不能超过 128 位');

    let typeCount = 0;
    if (/[a-z]/.test(value)) typeCount++;
    if (/[A-Z]/.test(value)) typeCount++;
    if (/\d/.test(value)) typeCount++;
    if (/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\;'/`~]/.test(value)) typeCount++;
    if (typeCount < 2) errors.push('密码需包含大写字母、小写字母、数字、特殊符号中的至少两种');

    if (['password', '123456', 'qwerty', 'abc123', '111111', '000000'].includes(value.toLowerCase())) {
        errors.push('密码过于简单，请使用更复杂的密码');
    }

    return { valid: errors.length === 0, errors };
}

function hashPassword(password, salt = null) {
    if (!salt) {
        salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
    }
    
    const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
    if (storedPassword.includes(':')) {
        const [salt, hash] = storedPassword.split(':');
        const newHash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
        return hash === newHash;
    } else {
        const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
        return storedPassword === legacyHash;
    }
}

function needsRehash(storedPassword) {
    return !storedPassword.includes(':');
}

const generateCardCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 16; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
};

let users = [];
let cards = [];

function loadUsers() {
    ensureDataDir();
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            users = Array.isArray(data.users) ? data.users : [];
        } else {
            users = [];
            saveUsers();
        }
    } catch (e) {
        console.error('加载用户数据失败:', e.message);
        users = [];
    }
}

function saveUsers() {
    ensureDataDir();
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf8');
    } catch (e) {
        console.error('保存用户数据失败:', e.message);
    }
}

function loadCards() {
    ensureDataDir();
    try {
        if (fs.existsSync(CARDS_FILE)) {
            const data = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));
            cards = Array.isArray(data.cards) ? data.cards : [];
        } else {
            cards = [];
            saveCards();
        }
    } catch (e) {
        console.error('加载卡密数据失败:', e.message);
        cards = [];
    }
}

function saveCards() {
    ensureDataDir();
    try {
        fs.writeFileSync(CARDS_FILE, JSON.stringify({ cards }, null, 2), 'utf8');
    } catch (e) {
        console.error('保存卡密数据失败:', e.message);
    }
}

function initDefaultAdmin() {
    loadUsers();
    // 只要系统已有任何管理员账号（无论是 admin 还是自定义管理员如 17630803121），绝不能再自动新建 'admin' 账号！
    const hasAnyAdmin = users.some(u => u.role === 'admin' || u.role === 'super_admin');
    if (!hasAnyAdmin && users.length === 0) {
        const defaultPassword = 'admin';
        users.push({
            username: 'admin',
            password: hashPassword(defaultPassword),
            role: 'admin',
            createdAt: Date.now(),
            accountLimit: 2,
            mustChangePassword: true,
            card: {
                days: -1,
                expiresAt: null
            }
        });
        saveUsers();
        console.log('[用户系统] 系统暂无管理员，已创建默认管理员账号，默认密码: admin');
    }
}

function validateUser(username, password, ip = 'unknown') {
    loadUsers();
    loadLoginAttempts();

    const rateLimitResult = checkRateLimit(ip);
    if (!rateLimitResult.allowed) {
        return { 
            error: 'rate_limit', 
            message: rateLimitResult.message,
            remainingMs: rateLimitResult.remainingMs
        };
    }

    const lockoutResult = checkAccountLockout(username);
    if (lockoutResult.locked) {
        return { 
            error: 'locked', 
            message: lockoutResult.message,
            remainingMs: lockoutResult.remainingMs
        };
    }
    
    const user = users.find(u => u.username === username);
    if (!user) {
        recordFailedAttempt(username);
        return { error: 'invalid_credentials', message: '用户名或密码错误' };
    }
    
    if (!verifyPassword(password, user.password)) {
        const attemptResult = recordFailedAttempt(username);
        if (attemptResult.locked) {
            return { 
                error: 'locked', 
                message: attemptResult.message 
            };
        }
        return { 
            error: 'invalid_credentials', 
            message: `用户名或密码错误，剩余尝试次数: ${attemptResult.remainingAttempts}` 
        };
    }
    
    clearFailedAttempts(username);
    
    if (needsRehash(user.password)) {
        user.password = hashPassword(password);
        saveUsers();
        console.log(`[安全] 用户 ${username} 密码已升级为新哈希算法`);
    }
    
    return {
        username: user.username,
        role: user.role,
        cardCode: user.cardCode || null,
        card: user.card || null,
        accountLimit: user.accountLimit || DEFAULT_ACCOUNT_LIMIT,
        avatar: user.avatar || '/default-user-avatar-256.png',
        enabled: user.enabled !== false
    };
}

function registerUser(username, password, cardCode) {
    loadUsers();
    loadCards();

    if (!username || username.length < 3 || username.length > 32) {
        return { ok: false, error: '用户名长度需在3-32位之间' };
    }

    if (!/^\w+$/.test(username)) {
        return { ok: false, error: '用户名只能包含字母、数字和下划线' };
    }

    if (users.find(u => u.username === username)) {
        return { ok: false, error: '用户名已存在' };
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
        return { ok: false, error: passwordValidation.errors.join('；') };
    }

    const card = cards.find(c => c.code === cardCode);
    if (!card) {
        return { ok: false, error: '卡密不存在' };
    }

    if (!card.enabled) {
        return { ok: false, error: '卡密已被禁用' };
    }

    if (card.usedBy) {
        return { ok: false, error: '卡密已被使用' };
    }

    if (card.isFree === true) {
        const freeCheck = checkFreeCardLimit({ username });
        if (!freeCheck.allowed) {
            return { ok: false, error: freeCheck.message };
        }
    }

    // 免费卡密严格风控：29 天内每账号/设备仅限一次（防爆破与多卡续费）
    if (card.isFree === true) {
        const freeCheck = checkFreeCardLimit({ username });
        if (!freeCheck.allowed) {
            return { ok: false, error: freeCheck.message };
        }
    }

    const cardType = card.type || 'time';
    if (cardType === 'quota') {
        return { ok: false, error: '注册只能使用时间卡密，额度卡密请登录后在续费中使用' };
    }

    const now = Date.now();
    
    const newUser = {
        username,
        password: hashPassword(password),
        role: 'user',
        cardCode,
        card: {
            code: card.code,
            description: card.description,
            days: card.days,
            expiresAt: card.days === -1 ? null : (now + card.days * 24 * 60 * 60 * 1000),
            enabled: true
        },
        accountLimit: DEFAULT_ACCOUNT_LIMIT,
        avatar: '/default-user-avatar-256.png',
        createdAt: now
    };

    users.push(newUser);
    card.usedBy = username;
    card.usedAt = now;

    saveUsers();
    saveCards();
    
    clearFailedAttempts(username);

    return { ok: true, user: { username: newUser.username, role: newUser.role, card: newUser.card, accountLimit: newUser.accountLimit, avatar: newUser.avatar } };
}

function renewUser(username, cardCode) {
    loadUsers();
    loadCards();

    const user = users.find(u => u.username === username);
    if (!user) {
        return { ok: false, error: '用户不存在' };
    }

    const card = cards.find(c => c.code === cardCode);
    if (!card) {
        return { ok: false, error: '卡密不存在' };
    }

    if (!card.enabled) {
        return { ok: false, error: '卡密已被禁用' };
    }

    if (card.usedBy) {
        return { ok: false, error: '卡密已被使用' };
    }

    const now = Date.now();
    const cardType = card.type || 'time';
    
    if (cardType === 'quota') {
        // 额度卡密：增加账号额度
        const currentLimit = user.accountLimit || DEFAULT_ACCOUNT_LIMIT;
        user.accountLimit = currentLimit + card.days;
    } else {
        // 时间卡密：增加使用时长
        // 确保用户有card对象
        if (!user.card) {
            user.card = {
                code: card.code,
                description: card.description,
                days: 0,
                expiresAt: null,
                enabled: true
            };
        }
        
        const currentExpires = user.card.expiresAt || 0;
        const currentDays = user.card.days || 0;
        
        // days为-1表示永久
        if (card.days === -1) {
            // 永久卡，设置为永久
            user.card.expiresAt = null;
            user.card.days = -1;
        } else if (user.card.days === -1) {
            // 已经是永久，保持永久
            user.card.expiresAt = null;
        } else {
            // 累加天数
            user.card.days = currentDays + card.days;
            
            // 计算新的过期时间
            if (currentExpires && currentExpires > now) {
                // 未过期，在当前过期时间基础上增加
                user.card.expiresAt = currentExpires + card.days * 24 * 60 * 60 * 1000;
            } else {
                // 已过期或无过期时间，从现在开始计算
                user.card.expiresAt = now + card.days * 24 * 60 * 60 * 1000;
            }
        }
    }

    // 标记卡密已使用
    card.usedBy = username;
    card.usedAt = now;
    if (card.isFree === true) {
        recordFreeCardUsage({ username, cardCode: card.code, action: 'use' });
    }

    saveUsers();
    saveCards();

    return { ok: true, card: user.card, accountLimit: user.accountLimit || DEFAULT_ACCOUNT_LIMIT, cardType };
}

function getAllUsers() {
    loadUsers();
    return users.map(u => ({
        username: u.username,
        role: u.role,
        card: u.card,
        createdAt: u.createdAt || null,
        accountLimit: u.accountLimit || DEFAULT_ACCOUNT_LIMIT
    }));
}

function updateUser(username, updates) {
    loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) return null;

    if (updates.expiresAt !== undefined) {
        if (!user.card) user.card = {};
        user.card.expiresAt = updates.expiresAt;
    }

    if (updates.enabled !== undefined) {
        if (!user.card) user.card = {};
        user.card.enabled = updates.enabled;
    }

    saveUsers();

    return { username: user.username, role: user.role, card: user.card, accountLimit: user.accountLimit || DEFAULT_ACCOUNT_LIMIT };
}

function editUser(oldUsername, updates) {
    loadUsers();
    
    const user = users.find(u => u.username === oldUsername);
    if (!user) {
        return { ok: false, error: '用户不存在' };
    }

    if (updates.newUsername && updates.newUsername !== oldUsername) {
        if (!/^\w{3,32}$/.test(updates.newUsername)) {
            return { ok: false, error: '用户名只能包含字母、数字和下划线，长度3-32位' };
        }
        const existingUser = users.find(u => u.username === updates.newUsername);
        if (existingUser) {
            return { ok: false, error: '用户名已存在' };
        }
        user.username = updates.newUsername;

        // 级联更新已用卡密所有者记录
        loadCards();
        let cardsChanged = false;
        for (const c of cards) {
            if (c.usedBy === oldUsername) {
                c.usedBy = updates.newUsername;
                cardsChanged = true;
            }
        }
        if (cardsChanged) saveCards();

        // 级联更新公开卡密领取记录
        loadCardClaimRecords();
        let claimsChanged = false;
        for (const r of cardClaimRecords) {
            if (r.username === oldUsername) {
                r.username = updates.newUsername;
                claimsChanged = true;
            }
        }
        if (claimsChanged) saveCardClaimRecords();
    }

    if (updates.password) {
        const passwordValidation = validatePasswordStrength(updates.password);
        if (!passwordValidation.valid) {
            return { ok: false, error: passwordValidation.errors.join('；') };
        }
        user.password = hashPassword(updates.password);
    }

    if (updates.accountLimit !== undefined) {
        user.accountLimit = Number.parseInt(updates.accountLimit, 10) || DEFAULT_ACCOUNT_LIMIT;
    }

    if (updates.isPermanent) {
        if (!user.card) user.card = {};
        user.card.days = -1;
        user.card.expiresAt = null;
    } else if (updates.expiresAt !== undefined) {
        if (!user.card) user.card = {};
        if (updates.expiresAt === null) {
            user.card.days = 0;
            user.card.expiresAt = null;
        } else {
            const now = Date.now();
            const expiresAt = Number.parseInt(updates.expiresAt, 10);
            user.card.expiresAt = expiresAt;
            const diffMs = expiresAt - now;
            const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
            user.card.days = diffDays > 0 ? diffDays : 0;
        }
    }

    saveUsers();

    return { 
        ok: true, 
        user: { 
            username: user.username, 
            role: user.role, 
            card: user.card, 
            accountLimit: user.accountLimit || DEFAULT_ACCOUNT_LIMIT 
        } 
    };
}

function getAllCards() {
    loadCards();
    return cards;
}

function createCard(description, days, type = 'time', isFree = false) {
    loadCards();

    const newCard = {
        code: generateCardCode(),
        description,
        days: Number.parseInt(days, 10) || 30,
        type: type === 'quota' ? 'quota' : 'time',
        isFree: Boolean(isFree),
        enabled: true,
        usedBy: null,
        usedAt: null,
        createdAt: Date.now()
    };

    cards.push(newCard);
    saveCards();

    return newCard;
}

function createCardsBatch(description, days, count, type = 'time', isFree = false) {
    loadCards();

    const createdCards = [];
    const daysNum = Number.parseInt(days, 10) || 30;
    const countNum = Math.min(Math.max(Number.parseInt(count, 10) || 1, 1), 100);
    const cardType = type === 'quota' ? 'quota' : 'time';
    const freeFlag = Boolean(isFree);

    for (let i = 0; i < countNum; i++) {
        const newCard = {
            code: generateCardCode(),
            description,
            days: daysNum,
            type: cardType,
            isFree: freeFlag,
            enabled: true,
            usedBy: null,
            usedAt: null,
            createdAt: Date.now()
        };
        cards.push(newCard);
        createdCards.push(newCard);
    }

    saveCards();

    return createdCards;
}

function updateCard(code, updates) {
    loadCards();
    const card = cards.find(c => c.code === code);
    if (!card) return null;

    if (updates.description !== undefined) {
        card.description = updates.description;
    }

    if (updates.enabled !== undefined) {
        card.enabled = updates.enabled;
    }

    saveCards();
    return card;
}

function deleteCard(code) {
    loadCards();
    const idx = cards.findIndex(c => c.code === code);
    if (idx === -1) return false;

    cards.splice(idx, 1);
    saveCards();
    return true;
}

function deleteCardsBatch(codes) {
    loadCards();
    if (!Array.isArray(codes) || codes.length === 0) {
        return { ok: false, error: '请提供要删除的卡密列表' };
    }

    let deletedCount = 0;
    const notFoundCodes = [];

    for (const code of codes) {
        const idx = cards.findIndex(c => c.code === code);
        if (idx !== -1) {
            cards.splice(idx, 1);
            deletedCount++;
        } else {
            notFoundCodes.push(code);
        }
    }

    saveCards();
    return {
        ok: true,
        deletedCount,
        notFoundCount: notFoundCodes.length,
        notFoundCodes: notFoundCodes.length > 0 ? notFoundCodes : undefined
    };
}

function deleteUser(username, forceDeleteAdmin = false) {
    loadUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx === -1) return { ok: false, error: '用户不存在' };

    // 不允许删除管理员账号（除非强制删除）
    if (!forceDeleteAdmin && users[idx].role === 'admin') {
        return { ok: false, error: '不能删除管理员账号' };
    }

    users.splice(idx, 1);
    saveUsers();
    return { ok: true };
}

function changePassword(username, oldPassword, newPassword) {
    loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) {
        return { ok: false, error: '用户不存在' };
    }

    if (!verifyPassword(oldPassword, user.password)) {
        return { ok: false, error: '当前密码错误' };
    }

    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
        return { ok: false, error: passwordValidation.errors.join('；') };
    }

    user.password = hashPassword(newPassword);
    if (user.mustChangePassword) {
        delete user.mustChangePassword;
    }

    saveUsers();
    return { ok: true, message: '密码修改成功' };
}

// 保存用户微信登录配置
// 获取用户微信登录配置
// 获取用户账号额度
// 检查用户是否可以添加更多账号
initDefaultAdmin();

// ============ 卡密领取功能 ============
function loadCardClaimRecords() {
    ensureDataDir();
    try {
        if (fs.existsSync(CARD_CLAIM_FILE)) {
            const data = JSON.parse(fs.readFileSync(CARD_CLAIM_FILE, 'utf8'));
            cardClaimEnabled = data.enabled === true;
            cardClaimRecords = data.records || [];
        } else {
            cardClaimEnabled = true;
            cardClaimRecords = [];
            saveCardClaimRecords();
        }
        // eslint-disable-next-line unused-imports/no-unused-vars
    } catch (e) {
        cardClaimEnabled = true;
        cardClaimRecords = [];
    }
}

function saveCardClaimRecords() {
    ensureDataDir();
    try {
        fs.writeFileSync(CARD_CLAIM_FILE, JSON.stringify({
            enabled: cardClaimEnabled,
            records: cardClaimRecords
        }, null, 2), 'utf8');
        // eslint-disable-next-line unused-imports/no-unused-vars
    } catch (e) {
        // console.error('保存卡密领取记录失败:', e.message);
    }
}

function getCardClaimStatus() {
    loadCardClaimRecords();
    return { enabled: cardClaimEnabled };
}

function setCardClaimStatus(enabled) {
    loadCardClaimRecords();
    cardClaimEnabled = !!enabled;
    saveCardClaimRecords();
    return { enabled: cardClaimEnabled };
}


const FREE_CARD_COOLDOWN_MS = 29 * 24 * 60 * 60 * 1000;

function checkFreeCardLimit({ ip = '', username = '', ua = '' } = {}) {
    loadCardClaimRecords();
    const now = Date.now();
    const uaHash = ua ? crypto.createHash('sha256').update(ua).digest('hex') : '';
    const normIp = String(ip || '').replace(/^.*:/, '').trim();
    const normUser = String(username || '').trim().toLowerCase();

    for (const r of cardClaimRecords) {
        const elapsed = now - Number(r.claimTime || r.usedTime || 0);
        if (elapsed < FREE_CARD_COOLDOWN_MS) {
            let matched = false;
            let reason = '';
            if (normUser && r.username && r.username.toLowerCase() === normUser) {
                matched = true;
                reason = '当前账号';
            } else if (normIp && r.ip && r.ip === normIp) {
                matched = true;
                reason = '您的网络IP';
            } else if (uaHash && r.uaHash && r.uaHash === uaHash) {
                matched = true;
                reason = '当前设备';
            }

            if (matched) {
                const remainingDays = Math.ceil((FREE_CARD_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
                return {
                    allowed: false,
                    remainingDays,
                    message: `免费卡密 29 天内仅限使用或领取一次！${reason}已参与过，距下次可用还剩 ${remainingDays} 天。`
                };
            }
        }
    }
    return { allowed: true };
}

function recordFreeCardUsage({ ip = '', username = '', ua = '', cardCode = '', action = 'use' } = {}) {
    loadCardClaimRecords();
    const uaHash = ua ? crypto.createHash('sha256').update(ua).digest('hex') : '';
    const normIp = String(ip || '').replace(/^.*:/, '').trim();
    cardClaimRecords.push({
        ip: normIp,
        uaHash,
        username: username || null,
        cardCode,
        action,
        claimTime: Date.now()
    });
    saveCardClaimRecords();
}

function checkUAClaimLimit(ua) {
    loadCardClaimRecords();
    const now = Date.now();
    const uaHash = crypto.createHash('sha256').update(ua).digest('hex');
    
    const record = cardClaimRecords.find(r => r.uaHash === uaHash);
    if (record) {
        const elapsed = now - record.claimTime;
        if (elapsed < 29 * 24 * 60 * 60 * 1000) {
            const remainingMs = 29 * 24 * 60 * 60 * 1000 - elapsed;
            return {
                allowed: false,
                remainingMs,
                message: '免费卡密 29 天内仅限领取一次！'
            };
        }
    }
    
    return { allowed: true };
}

function claimCardByUA(ua, username = null) {
    loadCards();
    loadCardClaimRecords();
    
    if (!cardClaimEnabled) {
        return { ok: false, error: '卡密领取功能未开启' };
    }
    
    const uaCheck = checkUAClaimLimit(ua);
    if (!uaCheck.allowed) {
        return { ok: false, error: uaCheck.message, remainingMs: uaCheck.remainingMs };
    }
    
    // 严格限制：只有管理员生成并标记为 isFree === true 的卡密才允许被免费领取
    const unusedFreeCards = cards.filter(c => 
        c.isFree === true &&
        c.type === 'time' && 
        !c.usedBy && 
        c.enabled
    );
    
    if (unusedFreeCards.length === 0) {
        return { ok: false, error: '当前暂无免费体验卡密，请联系管理员获取正式卡密！' };
    }
    
    const randomIndex = Math.floor(Math.random() * unusedFreeCards.length);
    const selectedCard = unusedFreeCards[randomIndex];
    
    const uaHash = crypto.createHash('sha256').update(ua).digest('hex');
    cardClaimRecords.push({
        uaHash,
        claimTime: Date.now(),
        cardCode: selectedCard.code,
        username: username || null
    });
    
    saveCardClaimRecords();
    
    return {
        ok: true,
        cardCode: selectedCard.code,
        days: selectedCard.days,
        description: selectedCard.description
    };
}

function getCardClaimRecords() {
    loadCardClaimRecords();
    return cardClaimRecords;
}

function clearExpiredClaimRecords() {
    loadCardClaimRecords();
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    const beforeCount = cardClaimRecords.length;
    cardClaimRecords = cardClaimRecords.filter(r => 
        now - r.claimTime < oneDayMs
    );
    
    if (cardClaimRecords.length !== beforeCount) {
        saveCardClaimRecords();
    }
    
    return { cleared: beforeCount - cardClaimRecords.length };
}

// ============ 登录日志 ============

let loginLogs = [];

function loadLoginLogs() {
    ensureDataDir();
    try {
        if (fs.existsSync(LOGIN_LOGS_FILE)) {
            const data = JSON.parse(fs.readFileSync(LOGIN_LOGS_FILE, 'utf8'));
            loginLogs = Array.isArray(data.logs) ? data.logs : [];
        } else {
            loginLogs = [];
        }
    } catch (e) {
        loginLogs = [];
    }
}

function saveLoginLogs() {
    ensureDataDir();
    try {
        fs.writeFileSync(LOGIN_LOGS_FILE, JSON.stringify({ logs: loginLogs }, null, 2), 'utf8');
    } catch (e) {
        console.error('保存登录日志失败:', e.message);
    }
}

/**
 * 记录一条登录日志。
 * @param {{event:'login_success'|'login_failed', username:string, ip?:string, userAgent?:string, errorType?:string|null}} entry
 */
function recordLoginLog({ event, username, ip = '', userAgent = '', errorType = null } = {}) {
    if (event !== 'login_success' && event !== 'login_failed') return null;

    loadLoginLogs();
    const log = {
        id: crypto.randomBytes(8).toString('hex'),
        timestamp: Date.now(),
        event,
        username: String(username || '').trim() || '(空)',
        errorType: errorType || null,
        ip: String(ip || '') || 'unknown',
        userAgent: String(userAgent || '') || 'unknown',
    };
    loginLogs.push(log);
    // 只保留最近的记录，避免文件无限增长
    if (loginLogs.length > LOGIN_LOG_LIMIT) {
        loginLogs = loginLogs.slice(-LOGIN_LOG_LIMIT);
    }
    saveLoginLogs();
    return log;
}

function getLoginLogs(limit = 100, offset = 0) {
    loadLoginLogs();
    const total = loginLogs.length;
    // 新的在前
    const ordered = [...loginLogs].reverse();
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), LOGIN_LOG_LIMIT);
    const safeOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
    return {
        logs: ordered.slice(safeOffset, safeOffset + safeLimit),
        total,
    };
}

function clearLoginLogs() {
    loginLogs = [];
    saveLoginLogs();
    return { ok: true };
}

// ============ 代理（分销） ============

const AGENT_SPECS_FILE = getDataFile('agent-specs.json');
const AGENT_RECHARGE_FILE = getDataFile('agent-recharge-cards.json');

let agentSpecs = [];
let agentRechargeCards = [];

function loadAgentSpecs() {
    ensureDataDir();
    try {
        if (fs.existsSync(AGENT_SPECS_FILE)) {
            const data = JSON.parse(fs.readFileSync(AGENT_SPECS_FILE, 'utf8'));
            agentSpecs = Array.isArray(data.specs) ? data.specs : [];
        } else {
            agentSpecs = [];
        }
    } catch (e) {
        agentSpecs = [];
    }
}

function saveAgentSpecs() {
    ensureDataDir();
    try {
        fs.writeFileSync(AGENT_SPECS_FILE, JSON.stringify({ specs: agentSpecs }, null, 2), 'utf8');
    } catch (e) {
        console.error('保存发卡规格失败:', e.message);
    }
}

function loadAgentRechargeCards() {
    ensureDataDir();
    try {
        if (fs.existsSync(AGENT_RECHARGE_FILE)) {
            const data = JSON.parse(fs.readFileSync(AGENT_RECHARGE_FILE, 'utf8'));
            agentRechargeCards = Array.isArray(data.cards) ? data.cards : [];
        } else {
            agentRechargeCards = [];
        }
    } catch (e) {
        agentRechargeCards = [];
    }
}

function saveAgentRechargeCards() {
    ensureDataDir();
    try {
        fs.writeFileSync(AGENT_RECHARGE_FILE, JSON.stringify({ cards: agentRechargeCards }, null, 2), 'utf8');
    } catch (e) {
        console.error('保存代理充值卡失败:', e.message);
    }
}

function normalizeAgentSpec(input = {}) {
    const type = input.type === 'quota' ? 'quota' : 'time';
    const isPermanent = type === 'time' && input.isPermanent === true;
    const durationUnit = input.durationUnit === 'hour' ? 'hour' : 'day';
    const durationValue = Number.parseInt(input.durationValue, 10);
    const value = Number.parseInt(input.value, 10);
    const accountLimit = Number.parseInt(input.accountLimit, 10);

    return {
        name: String(input.name || '').trim(),
        type,
        price: Math.max(0, Number(input.price) || 0),
        isPermanent,
        durationUnit,
        durationValue: isPermanent ? -1 : (durationValue > 0 ? durationValue : 7),
        // 额度卡用它表示增加的额度数
        value: value > 0 ? value : 0,
        accountLimit: accountLimit > 0 ? accountLimit : 0,
    };
}

function getAllAgentSpecs() {
    loadAgentSpecs();
    return agentSpecs;
}

function createAgentSpec(input = {}) {
    loadAgentSpecs();
    const normalized = normalizeAgentSpec(input);
    if (!normalized.name) return { ok: false, error: '请填写规格名称' };
    if (normalized.type === 'quota' && normalized.value <= 0) {
        return { ok: false, error: '额度规格需要填写大于 0 的额度值' };
    }

    const spec = {
        id: crypto.randomBytes(6).toString('hex'),
        ...normalized,
        enabled: true,
        createdAt: Date.now(),
    };
    agentSpecs.push(spec);
    saveAgentSpecs();
    return { ok: true, spec };
}

function updateAgentSpec(id, updates = {}) {
    loadAgentSpecs();
    const spec = agentSpecs.find(s => s.id === id);
    if (!spec) return { ok: false, error: '规格不存在' };

    if (updates.name !== undefined && String(updates.name).trim()) {
        spec.name = String(updates.name).trim();
    }
    if (updates.type !== undefined) {
        spec.type = updates.type === 'quota' ? 'quota' : 'time';
    }
    if (updates.price !== undefined) {
        spec.price = Math.max(0, Number(updates.price) || 0);
    }
    if (updates.enabled !== undefined) {
        spec.enabled = updates.enabled === true || updates.enabled === 'true';
    }
    if (updates.isPermanent !== undefined) {
        spec.isPermanent = updates.isPermanent === true || updates.isPermanent === 'true';
        if (spec.isPermanent) spec.durationValue = -1;
    }
    if (updates.durationUnit !== undefined) {
        spec.durationUnit = updates.durationUnit === 'hour' ? 'hour' : 'day';
    }
    if (updates.durationValue !== undefined && !spec.isPermanent) {
        const parsed = Number.parseInt(updates.durationValue, 10);
        if (parsed > 0) spec.durationValue = parsed;
    }
    if (updates.value !== undefined) {
        const parsed = Number.parseInt(updates.value, 10);
        if (parsed > 0) spec.value = parsed;
    }
    if (updates.accountLimit !== undefined) {
        const parsed = Number.parseInt(updates.accountLimit, 10);
        spec.accountLimit = parsed > 0 ? parsed : 0;
    }

    saveAgentSpecs();
    return { ok: true, spec };
}

function deleteAgentSpec(id) {
    loadAgentSpecs();
    const idx = agentSpecs.findIndex(s => s.id === id);
    if (idx === -1) return { ok: false, error: '规格不存在' };
    agentSpecs.splice(idx, 1);
    saveAgentSpecs();
    return { ok: true };
}

function publicAgentSpec(spec) {
    const durationText = spec.type === 'quota'
        ? `额度 +${spec.value}`
        : (spec.isPermanent ? '永久' : `${spec.durationValue}${spec.durationUnit === 'hour' ? '小时' : '天'}`);
    return {
        id: spec.id,
        name: spec.name,
        type: spec.type,
        price: spec.price,
        enabled: spec.enabled,
        isPermanent: !!spec.isPermanent,
        durationUnit: spec.durationUnit,
        durationValue: spec.durationValue,
        value: spec.value,
        accountLimit: spec.accountLimit || 0,
        durationText,
        createdAt: spec.createdAt,
    };
}

function publicAgent(user) {
    const quotaTotal = Number(user.quotaTotal ?? -1);
    const quotaDaily = Number(user.quotaDaily ?? -1);
    return {
        username: user.username,
        role: 'agent',
        enabled: user.enabled !== false,
        note: user.note || '',
        quotaTotal,
        quotaDaily,
        usedTotal: Number(user.usedTotal) || 0,
        usedDaily: Number(user.usedDaily) || 0,
        remainingTotal: quotaTotal < 0 ? -1 : Math.max(0, quotaTotal - (Number(user.usedTotal) || 0)),
        remainingDaily: quotaDaily < 0 ? -1 : Math.max(0, quotaDaily - (Number(user.usedDaily) || 0)),
        specIds: Array.isArray(user.specIds) ? user.specIds : null,
        balance: Number(user.balance) || 0,
        createdAt: user.createdAt || null,
    };
}

function getAllAgents() {
    loadUsers();
    return users.filter(u => u.role === 'agent').map(publicAgent);
}

function getAgent(username) {
    loadUsers();
    const user = users.find(u => u.username === username && u.role === 'agent');
    return user ? publicAgent(user) : null;
}

function getAgentSelf(username) {
    return getAgent(username);
}

function createAgent(input = {}) {
    loadUsers();
    const username = String(input.username || '').trim();
    const password = String(input.password || '');
    if (!/^\w{3,32}$/.test(username)) {
        return { ok: false, error: '代理用户名只能包含字母、数字和下划线，长度3-32位' };
    }
    if (!password) return { ok: false, error: '请填写代理密码' };
    if (users.find(u => u.username === username)) {
        return { ok: false, error: '用户名已存在' };
    }

    const quotaTotal = Number.parseInt(input.quotaTotal, 10);
    const quotaDaily = Number.parseInt(input.quotaDaily, 10);

    const agent = {
        username,
        password: hashPassword(password),
        role: 'agent',
        enabled: input.enabled === undefined ? true : input.enabled === true,
        note: String(input.note || ''),
        // -1 表示不限
        quotaTotal: Number.isFinite(quotaTotal) && quotaTotal >= 0 ? quotaTotal : -1,
        quotaDaily: Number.isFinite(quotaDaily) && quotaDaily >= 0 ? quotaDaily : -1,
        usedTotal: 0,
        usedDaily: 0,
        usedDailyDate: new Date().toISOString().slice(0, 10),
        specIds: Array.isArray(input.specIds) ? input.specIds : null,
        balance: Math.max(0, Number(input.balance) || 0),
        createdAt: Date.now(),
    };

    users.push(agent);
    saveUsers();
    return { ok: true, agent: publicAgent(agent) };
}

function editAgent(username, updates = {}) {
    loadUsers();
    const agent = users.find(u => u.username === username && u.role === 'agent');
    if (!agent) return { ok: false, error: '代理不存在' };

    if (updates.newUsername && updates.newUsername !== username) {
        const nextName = String(updates.newUsername).trim();
        if (!/^\w{3,32}$/.test(nextName)) {
            return { ok: false, error: '代理用户名只能包含字母、数字和下划线，长度3-32位' };
        }
        if (users.find(u => u.username === nextName)) {
            return { ok: false, error: '用户名已存在' };
        }
        const oldName = agent.username;
        agent.username = nextName;

        // 级联更新卡密的创建者归属，保证代理改名后历史卡密仍可对账
        loadCards();
        let changed = false;
        for (const card of cards) {
            if (card.createdBy === oldName) {
                card.createdBy = nextName;
                changed = true;
            }
        }
        if (changed) saveCards();
    }

    if (updates.password) {
        agent.password = hashPassword(String(updates.password));
    }
    if (updates.note !== undefined) {
        agent.note = String(updates.note || '');
    }
    if (updates.enabled !== undefined) {
        agent.enabled = updates.enabled === true || updates.enabled === 'true';
    }
    if (updates.quotaTotal !== undefined) {
        const parsed = Number.parseInt(updates.quotaTotal, 10);
        agent.quotaTotal = Number.isFinite(parsed) && parsed >= 0 ? parsed : -1;
    }
    if (updates.quotaDaily !== undefined) {
        const parsed = Number.parseInt(updates.quotaDaily, 10);
        agent.quotaDaily = Number.isFinite(parsed) && parsed >= 0 ? parsed : -1;
    }
    if (updates.specIds !== undefined) {
        agent.specIds = Array.isArray(updates.specIds) ? updates.specIds : null;
    }
    if (updates.balance !== undefined) {
        agent.balance = Math.max(0, Number(updates.balance) || 0);
    }

    saveUsers();
    return { ok: true, agent: publicAgent(agent) };
}

function deleteAgent(username) {
    loadUsers();
    const idx = users.findIndex(u => u.username === username && u.role === 'agent');
    if (idx === -1) return { ok: false, error: '代理不存在' };
    users.splice(idx, 1);
    saveUsers();
    return { ok: true };
}

function getCardsByCreator(creator) {
    loadCards();
    return cards.filter(c => c.createdBy === creator);
}

/**
 * 代理名下客户：使用该代理发出的卡密注册/续费的用户。
 * 卡密用 usedBy 记录消费者，卡密本身记录 createdBy（代理）。
 */
function getAgentCustomers(agentUsername) {
    loadUsers();
    loadCards();
    const cardMap = new Map();
    for (const card of cards) {
        if (card.createdBy !== agentUsername || !card.usedBy) continue;
        cardMap.set(card.code, card.usedBy);
    }

    const customers = [];
    for (const card of cards) {
        if (card.createdBy !== agentUsername || !card.usedBy) continue;
        const user = users.find(u => u.username === card.usedBy);
        if (!user) continue;
        customers.push({
            username: user.username,
            role: user.role,
            accountLimit: user.accountLimit || DEFAULT_ACCOUNT_LIMIT,
            createdAt: user.createdAt || null,
            card: user.card ? {
                expiresAt: user.card.expiresAt || null,
                enabled: user.card.enabled !== false,
                days: user.card.days,
                isPermanent: user.card.days === -1,
            } : null,
        });
    }

    // 同一用户可能用过多张该代理的卡密，按用户名去重
    const seen = new Set();
    return customers.filter((c) => {
        if (seen.has(c.username)) return false;
        seen.add(c.username);
        return true;
    });
}

function getAgentStats(username) {
    const agent = getAgent(username);
    if (!agent) return null;
    const owned = getCardsByCreator(username);
    const used = owned.filter(c => c.usedBy);
    return {
        ...agent,
        cardCount: owned.length,
        usedCardCount: used.length,
        unusedCardCount: owned.length - used.length,
        revenue: used.reduce((sum, c) => sum + (Number(c.price) || 0), 0),
        customerCount: getAgentCustomers(username).length,
    };
}

function getAgentDailyKey() {
    const { getDateKeyInTimezone } = require('../config/config');
    return getDateKeyInTimezone(new Date());
}

/** 代理自助发卡：校验规格、配额与余额，扣减并生成卡密 */
function generateAgentCards(username, { specId, count, description } = {}) {
    loadUsers();
    loadCards();
    loadAgentSpecs();

    const agent = users.find(u => u.username === username && u.role === 'agent');
    if (!agent) return { ok: false, error: '代理不存在' };
    if (agent.enabled === false) return { ok: false, error: '代理已被停用' };

    const spec = agentSpecs.find(s => s.id === specId);
    if (!spec) return { ok: false, error: '发卡规格不存在' };
    if (!spec.enabled) return { ok: false, error: '该发卡规格已被停用' };
    if (Array.isArray(agent.specIds) && agent.specIds.length > 0 && !agent.specIds.includes(specId)) {
        return { ok: false, error: '无权使用该发卡规格' };
    }

    const amount = Math.min(Math.max(Number.parseInt(count, 10) || 1, 1), 100);

    // 跨天重置每日用量
    const today = getAgentDailyKey();
    if (agent.usedDailyDate !== today) {
        agent.usedDaily = 0;
        agent.usedDailyDate = today;
    }

    const usedTotal = Number(agent.usedTotal) || 0;
    const usedDaily = Number(agent.usedDaily) || 0;
    if (agent.quotaTotal >= 0 && usedTotal + amount > agent.quotaTotal) {
        return { ok: false, error: `超出总额度，剩余 ${Math.max(0, agent.quotaTotal - usedTotal)} 张` };
    }
    if (agent.quotaDaily >= 0 && usedDaily + amount > agent.quotaDaily) {
        return { ok: false, error: `超出今日额度，剩余 ${Math.max(0, agent.quotaDaily - usedDaily)} 张` };
    }

    const unitPrice = Math.max(0, Number(spec.price) || 0);
    const cost = unitPrice * amount;
    const balance = Number(agent.balance) || 0;
    if (cost > 0 && balance < cost) {
        return { ok: false, error: `余额不足，需要 ${cost} 元，当前 ${balance} 元` };
    }

    const now = Date.now();
    const created = [];
    for (let i = 0; i < amount; i++) {
        const card = {
            code: generateCardCode(),
            description: description || spec.name,
            days: spec.type === 'quota' ? spec.value : spec.durationValue,
            type: spec.type,
            isFree: false,
            enabled: true,
            usedBy: null,
            usedAt: null,
            createdAt: now,
            createdBy: username,
            creatorRole: 'agent',
            specId: spec.id,
            price: unitPrice,
            isPermanent: !!spec.isPermanent,
            accountLimit: spec.accountLimit || 0,
        };
        cards.push(card);
        created.push(card);
    }

    agent.usedTotal = usedTotal + amount;
    agent.usedDaily = usedDaily + amount;
    agent.balance = balance - cost;

    saveCards();
    saveUsers();

    return {
        ok: true,
        cards: created,
        count: amount,
        cost,
        unitPrice,
        agent: publicAgent(agent),
    };
}

function getAllAgentRechargeCards() {
    loadAgentRechargeCards();
    return agentRechargeCards;
}

function createAgentRechargeCards({ amount, count, description, createdBy } = {}) {
    loadAgentRechargeCards();
    const faceValue = Math.max(0, Number(amount) || 0);
    if (faceValue <= 0) return { ok: false, error: '请填写大于 0 的充值面额' };

    const amountNum = Math.min(Math.max(Number.parseInt(count, 10) || 1, 1), 200);
    const generated = [];
    for (let i = 0; i < amountNum; i++) {
        const card = {
            code: generateCardCode(),
            amount: faceValue,
            description: String(description || ''),
            enabled: true,
            usedBy: null,
            usedAt: null,
            createdAt: Date.now(),
            createdBy: createdBy || null,
        };
        agentRechargeCards.push(card);
        generated.push(card);
    }
    saveAgentRechargeCards();
    return { ok: true, cards: generated, count: amountNum, amount: faceValue };
}

function deleteAgentRechargeCard(code) {
    loadAgentRechargeCards();
    const idx = agentRechargeCards.findIndex(c => c.code === code);
    if (idx === -1) return { ok: false, error: '充值卡不存在' };
    agentRechargeCards.splice(idx, 1);
    saveAgentRechargeCards();
    return { ok: true };
}

function redeemAgentRechargeCard(username, code) {
    loadUsers();
    loadAgentRechargeCards();

    const agent = users.find(u => u.username === username && u.role === 'agent');
    if (!agent) return { ok: false, error: '代理不存在' };

    const card = agentRechargeCards.find(c => c.code === String(code || '').trim());
    if (!card) return { ok: false, error: '充值卡不存在' };
    if (!card.enabled) return { ok: false, error: '充值卡已被禁用' };
    if (card.usedBy) return { ok: false, error: '充值卡已被使用' };

    const now = Date.now();
    card.usedBy = username;
    card.usedAt = now;
    agent.balance = (Number(agent.balance) || 0) + (Number(card.amount) || 0);

    saveAgentRechargeCards();
    saveUsers();

    return {
        ok: true,
        amount: card.amount,
        balance: agent.balance,
        agent: publicAgent(agent),
    };
}

function getAgentRechargeRecords(username) {
    loadAgentRechargeCards();
    return agentRechargeCards.filter(c => c.usedBy === username);
}

function clearExpiredUsers() {
    loadUsers();
    const now = Date.now();
    const expiredUsers = [];
    const usersToKeep = [];
    
    for (const user of users) {
        if (user.role === 'admin') {
            usersToKeep.push(user);
            continue;
        }
        
        if (user.card && user.card.expiresAt && user.card.expiresAt < now) {
            expiredUsers.push(user.username);
        } else {
            usersToKeep.push(user);
        }
    }
    
    if (expiredUsers.length > 0) {
        users = usersToKeep;
        saveUsers();
    }
    
    return {
        ok: true,
        deletedCount: expiredUsers.length,
        deletedUsers: expiredUsers
    };
}

function getUserCount() {
    loadUsers();
    return users.length;
}

const CARD_EXPIRY_EXEMPT_ROLES = new Set(['admin', 'super_admin', 'agent']);

/**
 * 判断用户名下的授权卡是否已到期。
 * 始终读取最新用户数据，避免使用登录时的会话快照。
 */
function isUserExpired(username, now = Date.now()) {
    loadUsers();
    const name = String(username || '');
    const user = users.find(u => u.username === name);
    if (!user || CARD_EXPIRY_EXEMPT_ROLES.has(String(user.role || ''))) return false;
    const expiresAt = Number(user.card && user.card.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now;
}

// 验证卡密是否属于指定用户
function verifyCardOwnership(username, cardCode) {
    loadUsers();
    loadCards();

    if (!username || !cardCode) {
        return { ok: false, error: '请提供用户名和卡密' };
    }

    const user = users.find(u => u.username === username);
    if (!user) {
        return { ok: false, error: '用户名或卡密错误' };
    }

    const card = cards.find(c => c.code === cardCode);
    if (!card) {
        return { ok: false, error: '用户名或卡密错误' };
    }

    if (card.usedBy !== username) {
        return { ok: false, error: '卡密不属于该用户' };
    }

    return { ok: true };
}

// 通过卡密验证重置密码（无需旧密码）
function resetPasswordByCard(username, cardCode, newPassword) {
    loadUsers();

    const verifyResult = verifyCardOwnership(username, cardCode);
    if (!verifyResult.ok) {
        return verifyResult;
    }

    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
        return { ok: false, error: passwordValidation.errors.join('；') };
    }

    const user = users.find(u => u.username === username);
    user.password = hashPassword(newPassword);
    if (user.mustChangePassword) {
        delete user.mustChangePassword;
    }

    clearFailedAttempts(username);
    saveUsers();

    return { ok: true, message: '密码重置成功' };
}

module.exports = {
    validateUser,
    registerUser,
    renewUser,
    getAllUsers,
    updateUser,
    editUser,
    getAllCards,
    createCard,
    createCardsBatch,
    updateCard,
    deleteCard,
    deleteCardsBatch,
    deleteUser,
    changePassword,
    validatePasswordStrength,
    DEFAULT_ACCOUNT_LIMIT,
    getCardClaimStatus,
    setCardClaimStatus,
    claimCardByUA,
    getCardClaimRecords,
    clearExpiredClaimRecords,
    clearExpiredUsers,
    getUserCount,
    isUserExpired,
    checkRateLimit,
    verifyCardOwnership,
    resetPasswordByCard,
    // 登录日志
    recordLoginLog,
    getLoginLogs,
    clearLoginLogs,
    // 代理
    getAllAgentSpecs,
    createAgentSpec,
    updateAgentSpec,
    deleteAgentSpec,
    publicAgentSpec,
    getAllAgents,
    getAgent,
    getAgentSelf,
    createAgent,
    editAgent,
    deleteAgent,
    getCardsByCreator,
    getAgentCustomers,
    getAgentStats,
    generateAgentCards,
    getAllAgentRechargeCards,
    createAgentRechargeCards,
    deleteAgentRechargeCard,
    redeemAgentRechargeCard,
    getAgentRechargeRecords,
};
