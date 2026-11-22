'use strict';

const { fail, handleError, json, readBody, requireUser, supabaseRequest } = require('./_lib/supabase');

module.exports = async (req, res) => {
    try {
        const { user } = await requireUser(req);
        if (req.method === 'GET') {
            const rows = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=*`);
            const profile = rows[0];
            return json(res, 200, profile ? {
                ...profile,
                email: profile.email || user.email,
                full_name: profile.full_name || profile.name || ''
            } : null);
        }
        if (req.method !== 'PUT') {
            res.setHeader('Allow', 'GET, PUT');
            return fail(res, 405, 'Metode tidak diizinkan.');
        }

        const input = readBody(req);
        const profile = {
            id: user.id,
            email: user.email,
            full_name: String(input.full_name || '').trim().slice(0, 100),
            campus: String(input.campus || '').trim().slice(0, 120),
            phone: String(input.phone || '').trim().slice(0, 30),
            student_id_last4: String(input.student_id_last4 || '').replace(/\D/g, '').slice(-4),
            entry_year: Number(input.entry_year) || null,
            avatar_url: typeof input.avatar_url === 'string' ? input.avatar_url.slice(0, 2048) : null
        };
        if (!profile.full_name) return fail(res, 400, 'Nama profil wajib diisi.');
        try {
            const rows = await supabaseRequest('/rest/v1/profiles?on_conflict=id&select=*', {
                method: 'POST',
                body: profile,
                headers: { Prefer: 'resolution=merge-duplicates,return=representation' }
            });
            return json(res, 200, { ...rows[0], full_name: rows[0].full_name || rows[0].name || profile.full_name });
        } catch (error) {
            if (error.code !== '42703') throw error;
            const rows = await supabaseRequest('/rest/v1/profiles?on_conflict=id&select=*', {
                method: 'POST',
                body: {
                    id: user.id,
                    name: profile.full_name,
                    campus: profile.campus,
                    avatar_url: profile.avatar_url
                },
                headers: { Prefer: 'resolution=merge-duplicates,return=representation' }
            });
            return json(res, 200, { ...rows[0], email: user.email, full_name: rows[0].full_name || rows[0].name || profile.full_name });
        }
    } catch (error) {
        return handleError(res, error);
    }
};
