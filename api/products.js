'use strict';

const { fail, handleError, json, readBody, requireUser, supabaseRequest } = require('./_lib/supabase');

const categories = new Set(['buku', 'elektronik', 'kost', 'pakaian', 'lainnya']);
const conditions = new Set(['baru', 'bekas-seperti-baru', 'bekas-pakai']);
const locations = new Set(['untidar', 'unimma', 'akmil', 'pusat_kota']);

const cleanProduct = (input, sellerId, existing = {}) => {
    const title = String(input.title || '').trim();
    const price = Number(input.price);
    const photos = Array.isArray(input.photos) ? input.photos.filter((value) => typeof value === 'string').slice(0, 5) : [];
    if (title.length < 3 || title.length > 80) throw Object.assign(new Error('Nama produk harus terdiri dari 3–80 karakter.'), { status: 400 });
    if (!Number.isSafeInteger(price) || price < 1000 || price > 1000000000) throw Object.assign(new Error('Harga produk tidak valid.'), { status: 400 });
    if (!categories.has(input.category) || !conditions.has(input.condition) || !locations.has(input.location_code)) {
        throw Object.assign(new Error('Kategori, kondisi, atau lokasi produk tidak valid.'), { status: 400 });
    }
    const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const photoPrefix = `${supabaseUrl}/storage/v1/object/public/product-images/${sellerId}/`;
    if (!supabaseUrl || photos.length === 0 ||
        photos.some((url) => url.length > 2048 || !url.startsWith(photoPrefix))) {
        throw Object.assign(new Error('Foto produk harus diunggah ke penyimpanan BBB.id.'), { status: 400 });
    }
    return {
        ...existing,
        seller_id: sellerId,
        title,
        category: input.category,
        price,
        condition: input.condition,
        location_code: input.location_code,
        description: String(input.description || '').trim().slice(0, 1000),
        photos,
        status: existing.status || 'active'
    };
};

module.exports = async (req, res) => {
    try {
        if (req.method === 'GET') {
            const params = new URL(req.url, 'https://bbb.invalid').searchParams;
            const id = params.get('id');
            const mine = params.get('mine') === '1';
            const user = mine ? (await requireUser(req)).user : null;
            const filter = id ? `id=eq.${encodeURIComponent(id)}`
                : mine ? `seller_id=eq.${encodeURIComponent(user.id)}`
                    : 'status=eq.active';
            const rows = await supabaseRequest(`/rest/v1/products?${filter}&select=*,seller:profiles!products_seller_id_fkey(full_name,campus)&order=created_at.desc`);
            return json(res, 200, rows);
        }
        if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) {
            res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
            return fail(res, 405, 'Metode tidak diizinkan.');
        }

        const { user } = await requireUser(req);
        const input = readBody(req);
        if (req.method === 'POST') {
            const product = cleanProduct(input, user.id);
            const rows = await supabaseRequest('/rest/v1/products?select=*', {
                method: 'POST',
                body: product,
                headers: { Prefer: 'return=representation' }
            });
            return json(res, 201, rows[0]);
        }

        const id = String(input.id || '');
        if (!id) return fail(res, 400, 'ID produk wajib diisi.');
        const existingRows = await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(id)}&seller_id=eq.${encodeURIComponent(user.id)}&select=*`);
        const existing = existingRows[0];
        if (!existing) return fail(res, 404, 'Produk tidak ditemukan atau bukan milik akun ini.');
        if (req.method === 'DELETE') {
            await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(id)}&seller_id=eq.${encodeURIComponent(user.id)}`, { method: 'DELETE' });
            return json(res, 200, { ok: true });
        }

        if (input.status && ['active', 'sold'].includes(input.status)) {
            const rows = await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(id)}&seller_id=eq.${encodeURIComponent(user.id)}&select=*`, {
                method: 'PATCH',
                body: { status: input.status },
                headers: { Prefer: 'return=representation' }
            });
            return json(res, 200, rows[0]);
        }
        const product = cleanProduct(input, user.id, existing);
        const rows = await supabaseRequest(`/rest/v1/products?id=eq.${encodeURIComponent(id)}&seller_id=eq.${encodeURIComponent(user.id)}&select=*`, {
            method: 'PATCH',
            body: product,
            headers: { Prefer: 'return=representation' }
        });
        return json(res, 200, rows[0]);
    } catch (error) {
        return handleError(res, error);
    }
};
