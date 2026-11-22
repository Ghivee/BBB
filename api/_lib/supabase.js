'use strict';

const json = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
};

const fail = (res, status, message) => json(res, status, { error: message });

const readBody = (req) => {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body);
        } catch {
            throw Object.assign(new Error('Isi permintaan bukan JSON yang valid.'), { status: 400 });
        }
    }
    return {};
};

const getPublicConfig = () => {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error('Supabase belum dikonfigurasi. Atur SUPABASE_URL dan SUPABASE_ANON_KEY.');
    }
    return { url: SUPABASE_URL.replace(/\/+$/, ''), anonKey: SUPABASE_ANON_KEY };
};

const getConfig = () => {
    const publicConfig = getPublicConfig();
    const { SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase belum dikonfigurasi. Atur SUPABASE_SERVICE_ROLE_KEY.');
    return { ...publicConfig, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY };
};

const supabaseRequest = async (path, { method = 'GET', body, headers = {}, userToken } = {}) => {
    const config = getConfig();
    const response = await fetch(`${config.url}${path}`, {
        method,
        headers: {
            apikey: config.serviceRoleKey,
            Authorization: `Bearer ${config.serviceRoleKey}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = text;
    }
    if (!response.ok) {
        const detail = typeof payload === 'object' && payload
            ? payload.message || payload.error_description || payload.error || payload.msg
            : payload;
        const error = new Error(`Supabase request failed (${response.status}): ${detail || 'unknown error'}`);
        error.status = response.status;
        error.code = typeof payload === 'object' && payload ? payload.code : undefined;
        throw error;
    }
    return payload;
};

const requireUser = async (req) => {
    const authorization = req.headers.authorization || '';
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
        const error = new Error('Masuk diperlukan.');
        error.status = 401;
        throw error;
    }
    const config = getConfig();
    const response = await fetch(`${config.url}/auth/v1/user`, {
        headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
        const error = new Error('Sesi Supabase tidak valid atau telah kedaluwarsa.');
        error.status = 401;
        throw error;
    }
    return { user: await response.json(), token };
};

const handleError = (res, error) => {
    console.error(error);
    if (['23505', '23514'].includes(error.code)) return fail(res, 409, 'Produk atau pesanan sudah berubah. Muat ulang halaman.');
    const status = Number.isInteger(error.status) ? error.status : 500;
    fail(res, status, status >= 500 ? 'Layanan belum dapat memproses permintaan.' : error.message);
};

module.exports = { fail, getConfig, getPublicConfig, handleError, json, readBody, requireUser, supabaseRequest };
