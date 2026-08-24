/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#02050A',
        surface: {
          DEFAULT: '#052053',
          dark: '#031435',
          light: '#0a2e73',
          card: 'rgba(5, 32, 83, 0.75)',
        },
        primary: {
          DEFAULT: '#044BDD',
          hover: '#0337A0',
          light: '#2563EB',
        },
        cinema: {
          bg: '#02050A',
          blue: '#044BDD',
          deep: '#052053',
          secondary: '#0337A0',
          green: '#2ECC71',
          cyan: '#5C98A7',
          lightCyan: '#C2D8DF',
          muted: '#8D98A7',
          warning: '#F5B942',
          danger: '#FF5C5C',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        cinematic: '0 10px 30px -10px rgba(4, 75, 221, 0.3)',
        'glow-blue': '0 0 20px rgba(4, 75, 221, 0.5)',
        'glow-green': '0 0 20px rgba(46, 204, 113, 0.5)',
      },
    },
  },
  plugins: [],
};
