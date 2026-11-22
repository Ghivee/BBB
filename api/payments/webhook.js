'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { fail, handleError, json, readBody, supabaseRequest } = require('../_lib/supabase');

const secureEqual = (expected, received) => {
    if (typeof received !== 'string' || !/^[a-f\d]{64}$/i.test(received)) return false;
    const left = Buffer.from(expected, 'hex');
    const right = Buffer.from(received, 'hex');
    return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

module.exports = async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return fail(res, 405, 'Metode tidak diizinkan.');
        }
        const event = readBody(req);
        const secret = process.env.YOBASEPAY_WEBHOOK_SECRET;
        if (!secret) return fail(res, 503, 'Verifikasi webhook belum dikonfigurasi.');
        const { trxid, amount, status, timestamp, signature } = event;
        if (!trxid || !Number.isSafeInteger(Number(amount)) || !Number.isSafeInteger(Number(event.amount_request)) ||
            !status || !timestamp || !signature) {
            return fail(res, 400, 'Payload webhook tidak lengkap.');
        }
        const stringToSign = `${trxid}|${amount}|${status}|${timestamp}`;
        const expected = createHmac('sha256', secret).update(stringToSign).digest('hex');
        if (!secureEqual(expected, signature)) return fail(res, 403, 'Signature webhook tidak valid.');

        const payments = await supabaseRequest(`/rest/v1/payments?provider_trx_id=eq.${encodeURIComponent(String(trxid))}&select=*`);
        const payment = payments[0];
        if (!payment) return fail(res, 404, 'Transaksi gateway tidak dikenal.');
        if (Number(payment.amount) !== Number(amount) || Number(payment.requested_amount) !== Number(event.amount_request)) {
            return fail(res, 409, 'Nominal callback tidak cocok dengan tagihan.');
        }
        if (status === 'SUCCESS') {
            if (payment.status === 'PENDING') {
                const changed = await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(payment.id)}&status=eq.PENDING&select=id`, {
                    method: 'PATCH',
                    body: { status: 'SUCCESS', paid_at: event.paid_at || new Date().toISOString(), updated_at: new Date().toISOString() }
                });
                if (!changed.length) {
                    const latest = await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(payment.id)}&select=status`);
                    if (latest[0]?.status !== 'SUCCESS') return fail(res, 409, 'Status transaksi sudah berubah.');
                }
            } else if (payment.status !== 'SUCCESS') {
                return fail(res, 409, 'Transaksi tidak lagi menunggu pembayaran.');
            }
            await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(payment.order_id)}&select=id`, {
                method: 'PATCH',
                body: { payment_status: 'paid', updated_at: new Date().toISOString() }
            });
            return json(res, 200, { received: true });
        }
        if (['EXPIRED', 'CANCELLED'].includes(status) && payment.status === 'PENDING') {
            const changed = await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(payment.id)}&status=eq.PENDING&select=id`, {
                method: 'PATCH',
                body: { status, updated_at: new Date().toISOString() }
            });
            if (changed.length) {
                await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(payment.order_id)}&payment_status=eq.pending`, {
                    method: 'PATCH',
                    body: { payment_status: 'unpaid', updated_at: new Date().toISOString() }
                });
            }
        }
        return json(res, 200, { received: true });
    } catch (error) {
        return handleError(res, error);
    }
};
