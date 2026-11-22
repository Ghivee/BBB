'use strict';

const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const profileHandler = require('../api/profile');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const userId = '22222222-2222-4222-8222-222222222222';

const response = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
});

const invoke = async (req) => {
    const res = {
        statusCode: 200,
        headers: {},
        setHeader(key, value) { this.headers[key] = value; },
        end(value) { this.body = value; }
    };
    await profileHandler(req, res);
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

test('profile read maps a legacy name column to the current client shape', async () => {
    global.fetch = async (input) => {
        const url = new URL(input);
        if (url.pathname === '/auth/v1/user') return response({ id: userId, email: 'qa@example.test' });
        if (url.pathname === '/rest/v1/profiles') {
            return response([{ id: userId, name: 'BBB QA Tester', campus: 'Universitas Tidar (UNTIDAR)' }]);
        }
        return response({ message: 'Unexpected request.' }, 500);
    };
    const result = await invoke({ method: 'GET', headers: { authorization: 'Bearer test-token' } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json.full_name, 'BBB QA Tester');
    assert.equal(result.json.email, 'qa@example.test');
});

test('profile write falls back to legacy profile columns when the migration is pending', async () => {
    const writes = [];
    global.fetch = async (input, options = {}) => {
        const url = new URL(input);
        if (url.pathname === '/auth/v1/user') return response({ id: userId, email: 'qa@example.test' });
        if (url.pathname === '/rest/v1/profiles') {
            writes.push(JSON.parse(options.body));
            if (writes.length === 1) return response({
                code: '42703',
                message: 'column profiles.email does not exist'
            }, 400);
            return response([{
                id: userId,
                name: 'BBB QA Tester',
                campus: 'Universitas Tidar (UNTIDAR)',
                avatar_url: null
            }]);
        }
        return response({ message: 'Unexpected request.' }, 500);
    };
    const result = await invoke({
        method: 'PUT',
        headers: { authorization: 'Bearer test-token' },
        body: { full_name: 'BBB QA Tester', campus: 'Universitas Tidar (UNTIDAR)' }
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json.full_name, 'BBB QA Tester');
    assert.equal(writes[1].name, 'BBB QA Tester');
    assert.equal('email' in writes[1], false);
});
