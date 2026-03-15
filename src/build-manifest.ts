#!/usr/bin/env node
/**
 * Build-time CLI manifest compiler.
 *
 * Scans all YAML/TS CLI definitions and pre-compiles them into a single
 * manifest.json for instant cold-start registration (no runtime YAML parsing).
 *
 * Usage: npx tsx src/build-manifest.ts
 * Output: dist/cli-manifest.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIS_DIR = path.resolve(__dirname, 'clis');
const OUTPUT = path.resolve(__dirname, '..', 'dist', 'cli-manifest.json');

interface ManifestEntry {
  site: string;
  name: string;
  description: string;
  domain?: string;
  strategy: string;
  browser: boolean;
  args: Array<{
    name: string;
    type?: string;
    default?: any;
    required?: boolean;
    help?: string;
    choices?: string[];
  }>;
  columns?: string[];
  pipeline?: any[];
  timeout?: number;
  /** 'yaml' or 'ts' — determines how executeCommand loads the handler */
  type: 'yaml' | 'ts';
  /** Relative path from clis/ dir, e.g. 'bilibili/hot.yaml' or 'bilibili/search.js' */
  modulePath?: string;
}

function scanYaml(filePath: string, site: string): ManifestEntry | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const def = yaml.load(raw) as any;
    if (!def || typeof def !== 'object') return null;

    const strategyStr = def.strategy ?? (def.browser === false ? 'public' : 'cookie');
    const strategy = strategyStr.toUpperCase();
    const browser = def.browser ?? (strategy !== 'PUBLIC');

    const args: ManifestEntry['args'] = [];
    if (def.args && typeof def.args === 'object') {
      for (const [argName, argDef] of Object.entries(def.args as Record<string, any>)) {
        args.push({
          name: argName,
          type: argDef?.type ?? 'str',
          default: argDef?.default,
          required: argDef?.required ?? false,
          help: argDef?.description ?? argDef?.help ?? '',
          choices: argDef?.choices,
        });
      }
    }

    return {
      site: def.site ?? site,
      name: def.name ?? path.basename(filePath, path.extname(filePath)),
      description: def.description ?? '',
      domain: def.domain,
      strategy: strategy.toLowerCase(),
      browser,
      args,
      columns: def.columns,
      pipeline: def.pipeline,
      timeout: def.timeout,
      type: 'yaml',
    };
  } catch (err: any) {
    process.stderr.write(`Warning: failed to parse ${filePath}: ${err.message}\n`);
    return null;
  }
}

function scanTs(filePath: string, site: string): ManifestEntry {
  // TS adapters self-register via cli() at import time.
  // We statically parse the source to extract metadata for the manifest stub.
  const baseName = path.basename(filePath, path.extname(filePath));
  const relativePath = `${site}/${baseName}.js`;

  const entry: ManifestEntry = {
    site,
    name: baseName,
    description: '',
    strategy: 'cookie',
    browser: true,
    args: [],
    type: 'ts',
    modulePath: relativePath,
  };

  try {
    const src = fs.readFileSync(filePath, 'utf-8');

    // Extract description
    const descMatch = src.match(/description\s*:\s*['"`]([^'"`]*)['"`]/);
    if (descMatch) entry.description = descMatch[1];

    // Extract domain
    const domainMatch = src.match(/domain\s*:\s*['"`]([^'"`]*)['"`]/);
    if (domainMatch) entry.domain = domainMatch[1];

    // Extract strategy
    const stratMatch = src.match(/strategy\s*:\s*Strategy\.(\w+)/);
    if (stratMatch) entry.strategy = stratMatch[1].toLowerCase();

    // Extract browser: false (some adapters bypass browser entirely)
    const browserMatch = src.match(/browser\s*:\s*(true|false)/);
    if (browserMatch) entry.browser = browserMatch[1] === 'true';

    // Extract columns
    const colMatch = src.match(/columns\s*:\s*\[([^\]]*)\]/);
    if (colMatch) {
      entry.columns = colMatch[1].split(',').map(s => s.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
    }

    // Extract args array items: { name: '...', ... }
    const argsBlockMatch = src.match(/args\s*:\s*\[([\s\S]*?)\]\s*,/);
    if (argsBlockMatch) {
      const argsBlock = argsBlockMatch[1];
      const argRegex = /\{\s*name\s*:\s*['"`](\w+)['"`]([^}]*)\}/g;
      let m;
      while ((m = argRegex.exec(argsBlock)) !== null) {
        const argName = m[1];
        const body = m[2];
        const typeMatch = body.match(/type\s*:\s*['"`](\w+)['"`]/);
        const defaultMatch = body.match(/default\s*:\s*([^,}]+)/);
        const requiredMatch = body.match(/required\s*:\s*(true|false)/);
        const helpMatch = body.match(/help\s*:\s*['"`]([^'"`]*)['"`]/);

        let defaultVal: any = undefined;
        if (defaultMatch) {
          const raw = defaultMatch[1].trim();
          if (raw === 'true') defaultVal = true;
          else if (raw === 'false') defaultVal = false;
          else if (/^\d+$/.test(raw)) defaultVal = parseInt(raw, 10);
          else if (/^\d+\.\d+$/.test(raw)) defaultVal = parseFloat(raw);
          else defaultVal = raw.replace(/^['"`]|['"`]$/g, '');
        }

        entry.args.push({
          name: argName,
          type: typeMatch?.[1] ?? 'str',
          default: defaultVal,
          required: requiredMatch?.[1] === 'true',
          help: helpMatch?.[1] ?? '',
        });
      }
    }
  } catch {
    // If parsing fails, fall back to empty metadata — module will self-register at runtime
  }

  return entry;
}

// Main
const manifest: ManifestEntry[] = [];

if (fs.existsSync(CLIS_DIR)) {
  for (const site of fs.readdirSync(CLIS_DIR)) {
    const siteDir = path.join(CLIS_DIR, site);
    if (!fs.statSync(siteDir).isDirectory()) continue;
    for (const file of fs.readdirSync(siteDir)) {
      const filePath = path.join(siteDir, file);
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const entry = scanYaml(filePath, site);
        if (entry) manifest.push(entry);
      } else if (
        (file.endsWith('.ts') && !file.endsWith('.d.ts') && file !== 'index.ts') ||
        (file.endsWith('.js') && !file.endsWith('.d.js') && file !== 'index.js')
      ) {
        manifest.push(scanTs(filePath, site));
      }
    }
  }
}

// Ensure output directory exists
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(manifest, null, 2));

const yamlCount = manifest.filter(e => e.type === 'yaml').length;
const tsCount = manifest.filter(e => e.type === 'ts').length;
console.log(`✅ Manifest compiled: ${manifest.length} entries (${yamlCount} YAML, ${tsCount} TS) → ${OUTPUT}`);
