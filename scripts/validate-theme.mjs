#!/usr/bin/env node
/**
 * Validate a theme package from the command line. Mirrors the rules in
 * `crates/aura-core/src/theme/validate.rs` so a theme author gets the same verdict from the
 * CLI as from the app. Keep the two in step.
 *
 *   node scripts/validate-theme.mjs themes/aura-default
 *
 * Exit code 0 = valid (warnings are printed but do not fail), 1 = invalid.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

const ENGINE = 'aura-theme/1';
const SOUND_SLOTS = ['move', 'select', 'back', 'launch', 'error'];
const APP_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  .version;

const errors = [];
const warnings = [];

const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const isKebabCase = (s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);

/** [major, minor, patch] from a semver core, or null when it is not semver. */
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** A referenced file must be relative, stay inside the theme, and exist. */
function checkAsset(dir, rel, what) {
  if (typeof rel !== 'string' || rel.trim() === '') {
    fail(`${what} path is empty`);
    return;
  }
  if (isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
    fail(`${what} \`${rel}\` must be relative to the theme folder`);
    return;
  }
  if (rel.split(/[\\/]/).includes('..')) {
    fail(`${what} \`${rel}\` escapes the theme folder`);
    return;
  }
  const target = join(dir, rel);
  if (!existsSync(target) || !statSync(target).isFile()) {
    fail(`${what} \`${rel}\` is missing`);
  }
}

/**
 * Relative `url(...)` targets in a stylesheet.
 *
 * Skips what is already loadable or is not a file reference at all: a scheme of two or more
 * characters (`data:`, `https:`, `asset:`), a protocol-relative or absolute path, and the `#id`
 * form that points at an SVG filter in the same document. A single letter before the colon is
 * *not* treated as a scheme, so `url(C:/...)` is caught as the absolute path it is.
 */
function cssUrls(css) {
  const out = [];
  for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    const target = match[2].trim();
    if (target === '' || /^(?:[a-z][a-z0-9+.-]+:|\/\/|\/|#)/i.test(target)) continue;
    out.push(target);
  }
  return out;
}

/**
 * Check one `url(...)` from `theme.css`. Mirrors `validate::css_asset`.
 *
 * Escaping the theme folder is fatal - it is the same path-traversal surface as folder shapes
 * (docs/RISKS.md R5), and the UI turns these paths into asset URLs. A *missing* file is only a
 * warning: the rule still applies and the browser falls back to the next font or shows no image,
 * so it is not worth costing the author their theme.
 */
function checkCssAsset(dir, rel) {
  const what = `theme.css \`url(${rel})\``;
  if (isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
    fail(`${what} must be a path relative to the theme folder`);
    return;
  }
  if (rel.split(/[\\/]/).includes('..')) {
    fail(`${what} escapes the theme folder`);
    return;
  }
  const target = join(dir, rel);
  if (!existsSync(target) || !statSync(target).isFile()) {
    warn(`theme.css references \`${rel}\`, which is missing; anything using it falls back`);
  }
}

function validate(dir) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail(`no manifest.json in ${dir}`);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    fail(`manifest.json is not valid JSON: ${e.message}`);
    return;
  }

  // ---- identity ----
  if (!manifest.id || !isKebabCase(manifest.id)) {
    fail(`theme id \`${manifest.id}\` must be kebab-case`);
  } else if (manifest.id !== basename(resolve(dir))) {
    fail(`theme id \`${manifest.id}\` must match its folder name \`${basename(resolve(dir))}\``);
  }
  if (!manifest.name || !String(manifest.name).trim()) fail('theme name must not be empty');
  if (!manifest.author || !String(manifest.author).trim()) warn('theme has no author');

  const engine = manifest.engine ?? ENGINE;
  if (engine !== ENGINE) fail(`unsupported theme engine \`${engine}\` (expected \`${ENGINE}\`)`);

  // ---- versions ----
  if (!parseSemver(manifest.version)) {
    fail(`version \`${manifest.version}\` is not semver`);
  }
  if (manifest.minAppVersion && String(manifest.minAppVersion).trim()) {
    const min = parseSemver(manifest.minAppVersion);
    const current = parseSemver(APP_VERSION);
    if (!min) {
      fail(`minAppVersion \`${manifest.minAppVersion}\` is not semver`);
    } else if (current && compareSemver(min, current) > 0) {
      fail(`theme needs Aura Shell ${manifest.minAppVersion} or newer (this is ${APP_VERSION})`);
    }
  }

  // ---- referenced files ----
  for (const [slot, rel] of Object.entries(manifest.sounds ?? {})) {
    checkAsset(dir, rel, `sound \`${slot}\``);
  }
  for (const [id, rel] of Object.entries(manifest.shaders ?? {})) {
    checkAsset(dir, rel, `shader \`${id}\``);
  }
  for (const rel of manifest.screenshots ?? []) {
    checkAsset(dir, rel, 'screenshot');
  }
  if (manifest.hasCss !== false) checkAsset(dir, 'theme.css', 'stylesheet');

  // ---- tokens / layout ----
  let tokens = {};
  const tokensPath = join(dir, 'tokens.json');
  if (existsSync(tokensPath)) {
    try {
      tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));
    } catch (e) {
      fail(`tokens.json is not valid JSON: ${e.message}`);
    }
  } else {
    warn('no tokens.json; every design token falls back to the built-in defaults');
  }
  for (const key of ['accent', 'background']) {
    if (tokens?.color?.[key] === undefined) {
      warn(`tokens.json has no \`color.${key}\`; the built-in fallback is used`);
    }
  }

  // layout.json is handed to the UI verbatim and references assets, so its paths get the same
  // safety rules as the manifest's. Mirrors `validate::sanitise_folder_shapes`, which drops
  // offending entries at runtime; here they are surfaced before a theme ships (RISKS.md R5).
  const layoutPath = join(dir, 'layout.json');
  if (existsSync(layoutPath)) {
    let layout = {};
    try {
      layout = JSON.parse(readFileSync(layoutPath, 'utf8'));
    } catch (e) {
      fail(`layout.json is not valid JSON: ${e.message}`);
    }

    const shapes = Array.isArray(layout.folderShapes) ? layout.folderShapes : [];
    const seen = new Set();
    for (const shape of shapes) {
      const id = typeof shape?.id === 'string' ? shape.id : '';
      if (!id.trim()) {
        fail('a folderShapes entry has no `id`');
        continue;
      }
      if (!isKebabCase(id)) fail(`folder shape id \`${id}\` must be kebab-case`);
      if (seen.has(id)) warn(`folder shape \`${id}\` is declared more than once`);
      seen.add(id);
      checkAsset(dir, shape?.asset ?? '', `folder shape \`${id}\``);
    }
  }

  // theme.css may reference the theme's own files - a bundled font, a background image - and
  // those paths get the same rules as the manifest's. The shell rewrites them to asset URLs as
  // it injects the stylesheet (src/theme/assets.ts); an absolute path would point somewhere
  // else on the machine entirely and never gets that treatment. Mirrors `validate::css_asset`.
  const cssPath = join(dir, 'theme.css');
  if (existsSync(cssPath)) {
    for (const ref of cssUrls(readFileSync(cssPath, 'utf8'))) checkCssAsset(dir, ref);
  }

  // A theme with no backdrop blur must not leave the focused window translucent: with nothing
  // blurred behind it, the desktop icons show straight through the window. Mirrors
  // `validate::tokens` in the core; see docs/THEME_FORMAT.md.
  {
    const blur = tokens?.blur?.surface;
    const opacity = tokens?.window?.opacity;
    const noBlur = blur !== undefined && Number.parseFloat(String(blur)) === 0;
    const translucent = opacity === undefined || Number.parseFloat(String(opacity)) < 100;
    if (noBlur && translucent) {
      warn(
        '`blur.surface` is 0 but `window.opacity` is below 100%: the focused window will show the ' +
          'desktop through it. Set `window.opacity` to "100%".',
      );
    }
  }

  // ---- warnings ----
  for (const slot of SOUND_SLOTS) {
    if (!(manifest.sounds ?? {})[slot]) {
      warn(`no \`${slot}\` sound; the default theme's sound is used`);
    }
  }
  // The app plays no music, so the five slots above are the whole set - the loader drops the rest.
  for (const slot of Object.keys(manifest.sounds ?? {})) {
    if (!SOUND_SLOTS.includes(slot)) {
      warn(`unknown sound slot \`${slot}\`; it is ignored (there is no music or ambience slot)`);
    }
  }

  return manifest;
}

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/validate-theme.mjs <theme-folder>');
  process.exit(1);
}
const dir = resolve(target);
console.log(`Validating ${dir}${sep}`);

const manifest = validate(dir);

for (const w of warnings) console.log(`  warning  ${w}`);
for (const e of errors) console.error(`  ERROR    ${e}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s) - theme is not loadable.`);
  process.exit(1);
}
console.log(
  `\nOK - \`${manifest?.id}\` v${manifest?.version} is valid` +
    (warnings.length ? ` (${warnings.length} warning(s))` : ''),
);
