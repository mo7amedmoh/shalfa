/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f1f3f9',
          100: '#e2e7f2',
          200: '#c5cfe5',
          300: '#9eafd2',
          400: '#748bb9',
          500: '#536ba0',
          600: '#3e5285',
          700: '#31416c',
          800: '#29375a',
          900: '#24304d',
          950: '#171f34',
        },
      },
      boxShadow: {
        card: '0 10px 30px rgba(27, 44, 88, 0.06)',
      },
    },
  },
  plugins: [],
};
