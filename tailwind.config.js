module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0070f3',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: '#f5f5f5',
          foreground: '#171717',
        },
        destructive: {
          DEFAULT: '#ff4d4f',
          foreground: '#ffffff',
        },
        accent: {
          DEFAULT: '#f5f5f5',
          foreground: '#171717',
        },
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        ring: '#0070f3',
        input: '#e5e5e5',
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
    },
  },
  plugins: [],
};