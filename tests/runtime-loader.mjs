/** Test-only transpiler for the exact source checkout; writes no artifacts outside this package. */
import { registerHooks } from 'node:module';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = process.env.DSH_SOURCE_ROOT;
if (!root) throw new Error('DSH_SOURCE_ROOT must point to the exact 0.2.2-rc.1 checkout');
const ts = (await import(pathToFileURL(resolve(root, 'node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/typescript.js')))).default;
const config = ts.readConfigFile(resolve(root, 'tsconfig.base.json'), path => readFileSync(path, 'utf8')).config;
const paths = Object.entries(config.compilerOptions.paths).sort(([a], [b]) => b.length - a.length);
registerHooks({
  resolve(specifier, context, nextResolve) {
    for (const [pattern, targets] of paths) {
      const star = pattern.indexOf('*');
      const match = star === -1 ? specifier === pattern : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
      if (!match) continue;
      const middle = star === -1 ? '' : specifier.slice(star, specifier.length - (pattern.length - star - 1));
      for (const target of targets) {
        let absolute = resolve(root, target.replace('*', middle));
        if (existsSync(absolute) && statSync(absolute).isDirectory()) absolute = resolve(absolute, 'index.ts');
        if (existsSync(absolute)) return nextResolve(pathToFileURL(absolute).href, context);
      }
    }
    try { return nextResolve(specifier, context); } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' || specifier.startsWith('.') || specifier.includes(':')) throw error;
      const parts = specifier.split('/');
      const packageName = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
      const suffix = parts.slice(specifier.startsWith('@') ? 2 : 1).join('/');
      const store = resolve(root, 'node_modules/.pnpm');
      const prefix = packageName.replace('/', '+') + '@';
      const candidates = readdirSync(store).filter(name => name.startsWith(prefix));
      if (!candidates.length) throw error;
      const packageDir = resolve(store, candidates[0], 'node_modules', packageName);
      const manifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));
      let target = suffix || manifest.module || manifest.main || 'index.js';
      if (manifest.exports) {
        let exportValue = manifest.exports[suffix ? `./${suffix}` : '.'] ?? (!suffix ? manifest.exports : undefined);
        while (exportValue && typeof exportValue === 'object') exportValue = exportValue.import ?? exportValue.node ?? exportValue.default;
        if (typeof exportValue === 'string') target = exportValue;
      }
      return nextResolve(pathToFileURL(resolve(packageDir, target)).href, context);
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && ['.ts', '.tsx'].includes(extname(fileURLToPath(url)))) {
      const source = readFileSync(fileURLToPath(url), 'utf8');
      const output = ts.transpileModule(source, { fileName: fileURLToPath(url), compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, experimentalDecorators: false } });
      return { format: 'module', source: output.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
