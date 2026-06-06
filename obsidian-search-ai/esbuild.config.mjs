import esbuild from 'esbuild';
import process from 'process';

const prod = process.argv.includes('production');

esbuild.build({
  entryPoints: ['main.ts'],
  bundle: true,
  external: ['obsidian', 'electron'],
  format: 'cjs',
  target: 'es2018',
  platform: 'node',
  outfile: 'main.js',
  minify: prod,
  sourcemap: prod ? false : 'inline',
}).catch(() => process.exit(1));
