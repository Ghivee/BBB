'use strict';

const { createHmac } = require('node:crypto');
const { fail, handleError, json, readBody, requireUser, supabaseRequest } = require('../_lib/supabase');

module.exports = async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return fail(res, 405, 'Metode tidak diizinkan.');
        }
        const { user } = await requireUser(req);
        const { order_id: orderId } = readBody(req);
        if (typeof orderId !== 'string' || !orderId) return fail(res, 400, 'ID pesanan wajib diisi.');

        const orders = await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&buyer_id=eq.${encodeURIComponent(user.id)}&select=*`);
        const order = orders[0];
        if (!order) return fail(res, 404, 'Pesanan tidak ditemukan.');
        if (order.payment_method !== 'online') return fail(res, 409, 'Pesanan ini menggunakan pembayaran langsung ke penjual.');
        if (order.order_status !== 'confirmed') return fail(res, 409, 'Penjual harus mengonfirmasi pesanan sebelum pembayaran.');
        if (order.payment_status === 'paid') return fail(res, 409, 'Pesanan ini sudah dibayar.');
        const staleBefore = encodeURIComponent(new Date(Date.now() - 5 * 60 * 1000).toISOString());
        await supabaseRequest(`/rest/v1/payments?order_id=eq.${encodeURIComponent(order.id)}&status=eq.CREATING&created_at=lt.${staleBefore}`, {
            method: 'PATCH',
            body: { status: 'FAILED', updated_at: new Date().toISOString() }
        });
        const existing = await supabaseRequest(`/rest/v1/payments?order_id=eq.${encodeURIComponent(order.id)}&status=in.(CREATING,PENDING)&select=payment_url,expired_at,provider_trx_id,amount,status`);
        if (existing[0]) {
            if (existing[0].status === 'PENDING') return json(res, 200, existing[0]);
            return fail(res, 409, 'Tagihan sedang dibuat. Tunggu sebentar lalu coba lagi.');
        }

        const apiKey = process.env.YOBASEPAY_API_KEY;
        const secret = process.env.YOBASEPAY_SECRET;
        const apiOrigin = process.env.YOBASEPAY_API_ORIGIN || 'https://yobasepay.net';
        if (!apiKey || !secret || !process.env.APP_BASE_URL) {
            return fail(res, 503, 'Pembayaran belum dikonfigurasi. Lengkapi environment YoBasePay dan URL situs.');
        }
        const amount = Number(order.total_amount);
        const reservations = await supabaseRequest('/rest/v1/payments?select=*', {
            method: 'POST',
            body: {
                order_id: order.id,
                provider: 'yobasepay',
                requested_amount: amount,
                amount,
                payment_url: '',
                status: 'CREATING'
            },
            headers: { Prefer: 'return=representation' }
        });
        const reservation = reservations[0];
        const gatewayOrderId = `BBB-${order.id}`;
        const signature = createHmac('sha256', secret)
            .update(`${apiKey}|createpayment|${amount}|${gatewayOrderId}`)
            .digest('hex');
        const url = new URL('/api', apiOrigin);
        url.search = new URLSearchParams({
            action: 'createpayment',
            apikey: apiKey,
            amount: String(amount),
            order_id: gatewayOrderId,
            signature
        });
        let gatewayResponse;
        let result;
        try {
            gatewayResponse = await fetch(url, {
                headers: { Referer: `${process.env.APP_BASE_URL.replace(/\/+$/, '')}/` }
            });
            result = await gatewayResponse.json();
        } catch (error) {
            await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(reservation.id)}&status=eq.CREATING`, {
                method: 'PATCH',
                body: { status: 'FAILED', updated_at: new Date().toISOString() }
            });
            throw error;
        }
        if (!gatewayResponse.ok || result.status !== true || !result.data?.trx_id || !result.data?.payment_url ||
            !Number.isSafeInteger(Number(result.data.amount)) || Number(result.data.amount) < amount) {
            await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(reservation.id)}&status=eq.CREATING`, {
                method: 'PATCH',
                body: { status: 'FAILED', updated_at: new Date().toISOString() }
            });
            console.error('YoBasePay createpayment rejected the request.', { status: gatewayResponse.status });
            return fail(res, 502, 'YoBasePay belum dapat membuat tagihan. Coba lagi atau hubungi dukungan.');
        }
        let paymentUrl;
        try {
            paymentUrl = new URL(result.data.payment_url);
        } catch {
            paymentUrl = null;
        }
        if (!paymentUrl || paymentUrl.protocol !== 'https:') {
            await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(reservation.id)}&status=eq.CREATING`, {
                method: 'PATCH',
                body: { status: 'FAILED', updated_at: new Date().toISOString() }
            });
            return fail(res, 502, 'YoBasePay mengembalikan tautan pembayaran yang tidak aman.');
        }

        const rows = await supabaseRequest(`/rest/v1/payments?id=eq.${encodeURIComponent(reservation.id)}&select=*`, {
            method: 'PATCH',
            body: {
                provider_trx_id: result.data.trx_id,
                requested_amount: amount,
                amount: Number(result.data.amount),
                payment_url: paymentUrl.href,
                status: 'PENDING',
                expired_at: result.data.expired_at || null,
                updated_at: new Date().toISOString()
            },
            headers: { Prefer: 'return=representation' }
        });
        await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}&payment_status=eq.unpaid`, {
            method: 'PATCH',
            body: { payment_status: 'pending', updated_at: new Date().toISOString() }
        });
        return json(res, 201, rows[0]);
    } catch (error) {
        return handleError(res, error);
    }
};
