/** @type {import('tailwindcss').Config} */
// Colours resolve to the CSS variables in src/styles/tokens.css, so every
// utility (bg-panel, text-mut, border-line…) follows the active theme.
const v = (name) => `var(--${name})`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        bg: v('bg'),
        panel: v('panel'),
        panel2: v('panel2'),
        panel3: v('panel3'),
        line: v('line'),
        line2: v('line2'),
        ink: v('ink'),
        mut: v('mut'),
        dim: v('dim'),
        acc: v('acc'),
        accInk: v('accInk'),
        hover: v('hover'),
        red: v('red'),
        redSoft: v('redSoft'),
        amber: v('amber'),
        amberSoft: v('amberSoft'),
        blue: v('blue'),
        blueSoft: v('blueSoft'),
        green: v('green'),
        greenSoft: v('greenSoft'),
      },
      boxShadow: {
        lift: v('cardLift'),
        hover: v('cardHover'),
        modal: v('modalShadow'),
      },
    },
  },
  plugins: [],
}
