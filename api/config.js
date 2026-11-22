'use strict';

const { fail, getPublicConfig, json } = require('./_lib/supabase');

module.exports = (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return fail(res, 405, 'Metode tidak diizinkan.');
    }
    try {
        const config = getPublicConfig();
        return json(res, 200, { supabaseUrl: config.url, supabaseAnonKey: config.anonKey });
    } catch (error) {
        console.error(error);
        return fail(res, 503, 'Layanan akun belum dikonfigurasi.');
    }
};
