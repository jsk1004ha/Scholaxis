import { ensureTranslationBackend, getTranslationDiagnostics } from '../src/translation-runtime.mjs';

await ensureTranslationBackend();
const diagnostics = getTranslationDiagnostics();
console.log(JSON.stringify(diagnostics, null, 2));

if (!diagnostics.ready) {
  process.exitCode = 1;
}
