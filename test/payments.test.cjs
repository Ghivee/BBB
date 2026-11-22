'use strict';

const { createHmac } = require('node:crypto');
const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const createPayment = require('../api/payments/create');
const paymentWebhook = require('../api/payments/webhook');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const orderId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

const response = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
});

const invoke = async (handler, { method = 'POST', body = {}, headers = {}, url = '/api/test' } = {}) => {
    const res = {
        statusCode: 200,
        headers: {},
        setHeader(key, value) { this.headers[key] = value; },
        end(value) { this.body = value; }
    };
    await handler({ method, body, headers, url }, res);
    return { ...res, json: res.body ? JSON.parse(res.body) : null };
};

beforeEach(() => {
    process.env.SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_ANON_KEY = 'anon-test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
    process.env.YOBASEPAY_API_KEY = 'api-key-test';
    process.env.YOBASEPAY_SECRET = 'create-secret-test';
    process.env.YOBASEPAY_WEBHOOK_SECRET = 'webhook-secret-test';
    process.env.APP_BASE_URL = 'https://bbb.test';
});

afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
});

test('payment creation trusts the stored order amount, not a client amount', async () => {
    const calls = [];
    global.fetch = async (input, options = {}) => {
        const url = new URL(input);
        calls.push({ url, options });
        if (url.hostname === 'supabase.test' && url.pathname === '/auth/v1/user') {
            return response({ id: userId, email: 'buyer@example.test' });
        }
        if (url.hostname === 'supabase.test' && url.pathname.endsWith('/orders') && (!options.method || options.method === 'GET')) {
            return response([{
                id: orderId,
                buyer_id: userId,
                payment_method: 'online',
                order_status: 'confirmed',
                payment_status: 'unpaid',
                total_amount: 10120
            }]);
        }
        if (url.hostname === 'supabase.test' && url.pathname.endsWith('/payments') && options.method === 'POST') {
            return response([{ id: 'payment-row-id' }]);
        }
        if (url.hostname === 'supabase.test' && url.pathname.endsWith('/payments') && options.method === 'PATCH') {
            if (url.searchParams.has('select')) {
                return response([{ id: 'payment-row-id', provider_trx_id: 'YO-123', amount: 10234 }]);
            }
            return response([]);
        }
        if (url.hostname === 'supabase.test' && url.pathname.endsWith('/payments') && (!options.method || options.method === 'GET')) {
            return response([]);
        }
        if (url.hostname === 'supabase.test' && url.pathname.endsWith('/orders') && options.method === 'PATCH') {
            return response([]);
        }
        if (url.hostname === 'yobasepay.net') {
            return response({
                status: true,
                data: { trx_id: 'YO-123', amount: 10234, payment_url: 'https://yobasepay.test/pay/YO-123', expired_at: null }
            });
        }
        return response({ message: `Unexpected test request: ${url}` }, 500);
    };

    const result = await invoke(createPayment, {
        headers: { authorization: 'Bearer user-access-token' },
        body: { order_id: orderId, amount: 1 }
    });
    assert.equal(result.statusCode, 201);
    assert.equal(result.json.amount, 10234);

    const gateway = calls.find((call) => call.url.hostname === 'yobasepay.net');
    assert.equal(gateway.url.searchParams.get('amount'), '10120');
    assert.equal(gateway.url.searchParams.get('order_id'), `BBB-${orderId}`);
    assert.equal(
        gateway.url.searchParams.get('signature'),
        createHmac('sha256', 'create-secret-test')
            .update(`api-key-test|createpayment|10120|BBB-${orderId}`)
            .digest('hex')
    );
});

test('webhook rejects an invalid HMAC before reading transaction rows', async () => {
    let databaseCalls = 0;
    global.fetch = async () => {
        databaseCalls += 1;
        return response([]);
    };
    const result = await invoke(paymentWebhook, {
        body: {
            trxid: 'YO-123',
            amount: 10234,
            amount_request: 10120,
            status: 'SUCCESS',
            timestamp: '2026-04-13 19:30:05',
            signature: '00'.repeat(32)
        }
    });
    assert.equal(result.statusCode, 403);
    assert.equal(databaseCalls, 0);
});

test('webhook validates both billed and requested amounts and records success', async () => {
    const databaseCalls = [];
    global.fetch = async (input, options = {}) => {
        const url = new URL(input);
        databaseCalls.push({ url, options });
        if (url.pathname.endsWith('/payments') && (!options.method || options.method === 'GET')) {
            return response([{
                id: 'payment-row-id',
                order_id: orderId,
                provider_trx_id: 'YO-123',
                requested_amount: 10120,
                amount: 10234,
                status: 'PENDING'
            }]);
        }
        return response([{ id: 'payment-row-id' }]);
    };
    const event = {
        trxid: 'YO-123',
        amount: 10234,
        amount_request: 10120,
        status: 'SUCCESS',
        timestamp: '2026-04-13 19:30:05',
        paid_at: '2026-04-13 19:30:00'
    };
    event.signature = createHmac('sha256', 'webhook-secret-test')
        .update(`${event.trxid}|${event.amount}|${event.status}|${event.timestamp}`)
        .digest('hex');

    const result = await invoke(paymentWebhook, { body: event });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json.received, true);
    assert.equal(databaseCalls.filter((call) => call.options.method === 'PATCH').length, 2);
});
