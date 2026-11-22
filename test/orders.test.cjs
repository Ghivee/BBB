'use strict';

const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const createOrder = require('../api/orders');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const userId = '22222222-2222-4222-8222-222222222222';
const sellerId = '33333333-3333-4333-8333-333333333333';
const productId = '11111111-1111-4111-8111-111111111111';

const response = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
});

const invoke = async (handler, req) => {
    const res = {
        statusCode: 200,
        headers: {},
        setHeader(key, value) { this.headers[key] = value; },
        end(value) { this.body = value; }
    };
    await handler(req, res);
    return { ...res, json: res.body ? JSON.parse(res.body) : null };
};

beforeEach(() => {
    process.env.SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_ANON_KEY = 'anon-test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
});

afterEach(() => {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
});

test('order creation takes product price from Supabase, not the request body', async () => {
    let insertedOrder;
    global.fetch = async (input, options = {}) => {
        const url = new URL(input);
        if (url.pathname === '/auth/v1/user') return response({ id: userId, email: 'buyer@example.test' });
        if (url.pathname === '/rest/v1/products') {
            return response([{ id: productId, seller_id: sellerId, price: 24000, status: 'active' }]);
        }
        if (url.pathname === '/rest/v1/orders' && options.method === 'POST') {
            insertedOrder = JSON.parse(options.body);
            return response([{
                id: '44444444-4444-4444-8444-444444444444',
                ...insertedOrder,
                total_amount: 36000
            }]);
        }
        return response({ message: `Unexpected test request: ${url}` }, 500);
    };

    const result = await invoke(createOrder, {
        method: 'POST',
        url: '/api/orders',
        headers: { authorization: 'Bearer user-access-token' },
        body: {
            product_id: productId,
            fulfillment: 'delivery',
            payment_method: 'online',
            meeting_point: 'Gerbang kampus',
            price: 1,
            item_amount: 1,
            total_amount: 1
        }
    });

    assert.equal(result.statusCode, 201);
    assert.equal(insertedOrder.item_amount, 24000);
    assert.equal(insertedOrder.delivery_fee, 12000);
    assert.equal(insertedOrder.payment_method, 'online');
    assert.equal(Object.hasOwn(insertedOrder, 'total_amount'), false);
    assert.equal(result.json.total_amount, 36000);
});
