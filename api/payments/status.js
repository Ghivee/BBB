'use strict';

const { fail, handleError, json, requireUser, supabaseRequest } = require('../_lib/supabase');

module.exports = async (req, res) => {
    try {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return fail(res, 405, 'Metode tidak diizinkan.');
        }
        const { user } = await requireUser(req);
        const trxId = new URL(req.url, 'https://bbb.invalid').searchParams.get('trxid');
        if (!trxId) return fail(res, 400, 'ID transaksi wajib diisi.');
        const payments = await supabaseRequest(`/rest/v1/payments?provider_trx_id=eq.${encodeURIComponent(trxId)}&select=*`);
        const payment = payments[0];
        if (!payment) return fail(res, 404, 'Transaksi tidak ditemukan.');
        const orders = await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(payment.order_id)}&buyer_id=eq.${encodeURIComponent(user.id)}&select=id,payment_status`);
        if (!orders[0]) return fail(res, 404, 'Transaksi bukan milik akun ini.');
        if (payment.status !== 'PENDING') return json(res, 200, { status: payment.status, order_id: payment.order_id });

        const apiKey = process.env.YOBASEPAY_API_KEY;
        const apiOrigin = process.env.YOBASEPAY_API_ORIGIN || 'https://yobasepay.net';
        if (!apiKey) return fail(res, 503, 'Pemeriksaan status pembayaran belum dikonfigurasi.');
        const url = new URL('/api', apiOrigin);
        url.search = new URLSearchParams({ action: 'checkstatus', apikey: apiKey, trxid: trxId });
        const response = await fetch(url);
        const result = await response.json();
        if (!response.ok || result.status !== true || !result.data?.status) return fail(res, 502, 'Status pembayaran belum dapat diperiksa.');
        if (Number(result.data.amount) !== Number(payment.amount)) return fail(res, 409, 'Nominal status gateway tidak cocok dengan tagihan.');
        if (result.data.amount_request !== undefined && Number(result.data.amount_request) !== Number(payment.requested_amount)) {
            return fail(res, 409, 'Nominal dasar transaksi tidak cocok dengan tagihan.');
        }
        if (result.data.status === 'SUCCESS') {
            const changed = await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(payment.id)}&status=eq.PENDING&select=id`, {
                method: 'PATCH',
                body: { status: 'SUCCESS', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            });
            let confirmed = changed.length > 0 || payment.status === 'SUCCESS';
            if (!confirmed) {
                const latest = await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(payment.id)}&select=status`);
                confirmed = latest[0]?.status === 'SUCCESS';
            }
            if (confirmed) {
                await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(payment.order_id)}`, {
                    method: 'PATCH',
                    body: { payment_status: 'paid', updated_at: new Date().toISOString() }
                });
            } else return fail(res, 409, 'Status transaksi sudah berubah.');
        } else if (['EXPIRED', 'CANCELLED'].includes(result.data.status)) {
            const changed = await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(payment.id)}&status=eq.PENDING&select=id`, {
                method: 'PATCH',
                body: { status: result.data.status, updated_at: new Date().toISOString() }
            });
            if (changed.length) {
                await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(payment.order_id)}&payment_status=eq.pending`, {
                    method: 'PATCH',
                    body: { payment_status: 'unpaid', updated_at: new Date().toISOString() }
                });
            }
        }
        return json(res, 200, { status: result.data.status, order_id: payment.order_id });
    } catch (error) {
        return handleError(res, error);
    }
};
