'use strict';

const { fail, handleError, json, readBody, requireUser, supabaseRequest } = require('./_lib/supabase');

module.exports = async (req, res) => {
    try {
        const { user } = await requireUser(req);
        if (req.method === 'GET') {
            const rows = await supabaseRequest(`/rest/v1/orders?or=(buyer_id.eq.${encodeURIComponent(user.id)},seller_id.eq.${encodeURIComponent(user.id)})&select=*,products(title,photos,category,condition,location_code,seller:profiles!products_seller_id_fkey(full_name,campus)),payments(status,provider_trx_id,payment_url,amount,expired_at)&order=created_at.desc`);
            return json(res, 200, rows);
        }
        if (!['POST', 'PATCH'].includes(req.method)) {
            res.setHeader('Allow', 'GET, POST, PATCH');
            return fail(res, 405, 'Metode tidak diizinkan.');
        }

        const input = readBody(req);
        if (req.method === 'POST') {
            const productRows = await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(String(input.product_id || ''))}&select=id,seller_id,price,status`);
            const product = productRows[0];
            if (!product || product.status !== 'active') return fail(res, 409, 'Produk tidak tersedia untuk dipesan.');
            if (product.seller_id === user.id) return fail(res, 403, 'Kamu tidak dapat membeli produk milik sendiri.');
            const fulfillment = input.fulfillment === 'delivery' ? 'delivery' : input.fulfillment === 'meetup' ? 'meetup' : '';
            const paymentMethod = input.payment_method === 'online' ? 'online' : input.payment_method === 'cod' ? 'cod' : '';
            const meetingPoint = String(input.meeting_point || '').trim().slice(0, 120);
            if (!fulfillment || !paymentMethod || meetingPoint.length < 3) return fail(res, 400, 'Cara menerima barang, pembayaran, dan titik pertemuan wajib diisi.');
            const deliveryFee = fulfillment === 'delivery' ? 12000 : 0;
            const order = {
                product_id: product.id,
                buyer_id: user.id,
                seller_id: product.seller_id,
                fulfillment,
                payment_method: paymentMethod,
                meeting_point: meetingPoint,
                item_amount: Number(product.price),
                delivery_fee: deliveryFee,
                order_status: 'awaiting-seller',
                payment_status: 'unpaid'
            };
            const rows = await supabaseRequest('/rest/v1/orders?select=*', {
                method: 'POST',
                body: order,
                headers: { Prefer: 'return=representation' }
            });
            return json(res, 201, rows[0]);
        }

        const orderId = String(input.id || '');
        const next = String(input.action || '');
        const rows = await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`);
        const order = rows[0];
        if (!order || ![order.buyer_id, order.seller_id].includes(user.id)) return fail(res, 404, 'Pesanan tidak ditemukan.');
        const transitions = {
            confirm: { from: 'awaiting-seller', to: 'confirmed', role: 'seller' },
            decline: { from: 'awaiting-seller', to: 'cancelled', role: 'seller' },
            cancel: { from: 'awaiting-seller', to: 'cancelled', role: 'buyer' },
            'confirm-offline': { from: 'awaiting-seller', to: 'confirmed', role: 'buyer' },
            ready: { from: 'confirmed', to: 'ready', role: 'seller' },
            complete: { from: 'ready', to: 'completed', role: 'buyer' }
        };
        const transition = transitions[next];
        if (!transition || order.order_status !== transition.from ||
            (transition.role === 'buyer' ? order.buyer_id !== user.id : order.seller_id !== user.id)) {
            return fail(res, 409, 'Aksi ini tidak tersedia untuk status atau akun pesanan ini.');
        }
        if (next === 'confirm-offline' && order.payment_method !== 'cod') {
            return fail(res, 409, 'Pesanan online harus dikonfirmasi oleh penjual sebelum dibayar.');
        }
        if (next === 'ready' && order.payment_method === 'online' && order.payment_status !== 'paid') {
            return fail(res, 409, 'Pembayaran harus berhasil sebelum barang diserahkan.');
        }
        if (next === 'complete' && order.payment_method === 'online' && order.payment_status !== 'paid') {
            return fail(res, 409, 'Pesanan belum dapat diselesaikan sebelum pembayaran berhasil.');
        }
        const updated = await supabaseRequest(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&order_status=eq.${transition.from}&select=*`, {
            method: 'PATCH',
            body: { order_status: transition.to, updated_at: new Date().toISOString() },
            headers: { Prefer: 'return=representation' }
        });
        if (!updated.length) return fail(res, 409, 'Status pesanan sudah berubah. Muat ulang halaman.');
        return json(res, 200, updated[0]);
    } catch (error) {
        return handleError(res, error);
    }
};
