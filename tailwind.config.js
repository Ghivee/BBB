/**
 * BBB.id — satu-satunya sumber token desain.
 * Semua halaman memakai token yang sama (warna, jarak, container, font)
 * supaya tampilan tidak berbeda antar halaman.
 * Warna di sini wajib sama persis dengan variabel di src/app.css.
 */
module.exports = {
    content: ['./*.html', './*/*.html', './app.js'],
    theme: {
        container: { center: true },
        extend: {
            colors: {
                primary: '#087653',
                'primary-container': '#0a8f66',
                'on-primary': '#ffffff',
                'on-primary-container': '#f2fbf6',
                secondary: '#a86c07',
                'secondary-container': '#f0b45c',
                'on-secondary': '#ffffff',
                'on-secondary-container': '#40290a',
                tertiary: '#1d5f8a',
                'tertiary-container': '#cfe6f4',
                'on-tertiary': '#ffffff',
                'on-tertiary-container': '#0d2b3d',
                error: '#a5322b',
                'error-container': '#fde8e6',
                'on-error': '#ffffff',
                'on-error-container': '#6b1a15',
                'success-green': '#1e9e63',
                'status-verified': '#e6f4ec',
                'text-main': '#18231f',
                'text-muted': '#5b6a61',
                'on-surface': '#18231f',
                'on-background': '#18231f',
                'on-surface-variant': '#4c5b52',
                outline: '#6d7a73',
                'outline-variant': '#cbd8cf',
                background: '#f5f8f6',
                surface: '#f5f8f6',
                'surface-bright': '#f5f8f6',
                'surface-white': '#ffffff',
                'surface-container-lowest': '#ffffff',
                'surface-container-low': '#eef4f0',
                'surface-container': '#eaf1ed',
                'surface-container-high': '#e3ebe6',
                'surface-container-highest': '#dbe5de',
                'surface-variant': '#e3ebe6',
                'surface-dim': '#d3ded7',
                'inverse-surface': '#243029',
                'inverse-on-surface': '#eef3f0',
                'inverse-primary': '#8fd9b6',
                'primary-fixed': '#a9e3c7',
                'primary-fixed-dim': '#8fd9b6',
                'on-primary-fixed': '#06301f',
                'on-primary-fixed-variant': '#0b4c33',
                'surface-tint': '#087653'
            },
            borderRadius: {
                DEFAULT: '0.25rem',
                lg: '0.5rem',
                xl: '0.75rem',
                full: '9999px'
            },
            spacing: {
                gutter: '16px',
                'margin-mobile': '16px',
                'margin-desktop': '32px',
                base: '8px',
                'container-max': '1280px'
            },
            fontFamily: {
                'headline-lg': ['Inter', 'system-ui', 'sans-serif'],
                'headline-lg-mobile': ['Inter', 'system-ui', 'sans-serif'],
                'display-lg': ['Inter', 'system-ui', 'sans-serif'],
                'body-lg': ['Inter', 'system-ui', 'sans-serif'],
                'body-sm': ['Inter', 'system-ui', 'sans-serif'],
                'title-md': ['Inter', 'system-ui', 'sans-serif'],
                'label-bold': ['Inter', 'system-ui', 'sans-serif'],
                'price-tag': ['Inter', 'system-ui', 'sans-serif']
            },
            fontSize: {
                'headline-lg': ['32px', { lineHeight: '40px', fontWeight: '700' }],
                'headline-lg-mobile': ['24px', { lineHeight: '32px', fontWeight: '700' }],
                'display-lg': ['48px', { lineHeight: '56px', letterSpacing: '-0.02em', fontWeight: '700' }],
                'title-md': ['20px', { lineHeight: '28px', fontWeight: '600' }],
                'body-lg': ['16px', { lineHeight: '24px', fontWeight: '400' }],
                'body-sm': ['14px', { lineHeight: '20px', fontWeight: '400' }],
                'price-tag': ['18px', { lineHeight: '24px', fontWeight: '700' }],
                'label-bold': ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '600' }]
            },
            maxWidth: {
                'container-max': '1280px'
            },
            boxShadow: {
                card: '0 4px 12px rgba(24, 35, 31, 0.05)',
                'card-hover': '0 10px 24px rgba(8, 118, 83, 0.10)'
            }
        }
    },
    plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')],
    safelist: [
        'bg-primary',
        'text-on-primary',
        'bg-surface-white',
        'text-on-surface',
        'hidden',
        'is-active',
        'is-current',
        'is-complete',
        'is-dragging',
        'icon-fill',
        'line-clamp-1',
        'line-clamp-2'
    ]
};