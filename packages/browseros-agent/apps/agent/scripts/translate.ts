/**
 * Auto-translate locale files using Claude API.
 *
 * Usage:
 *   bun run scripts/translate.ts                     # translate all target languages
 *   bun run scripts/translate.ts --lang=zh_CN        # translate one language
 *   bun run scripts/translate.ts --lang=ja --dry-run # preview without writing
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const LOCALES_DIR = join(import.meta.dir, '..', 'locales')
const SOURCE_LOCALE = 'en'

// Target languages to translate to
const TARGET_LOCALES: Record<string, string> = {
  zh_CN: 'Chinese Simplified',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt_BR: 'Portuguese (Brazil)',
}

// Terms that should NOT be translated
const PRESERVE_TERMS = [
  'BrowserOS',
  'GitHub',
  'Github',
  'OpenAI',
  'Anthropic',
  'Gemini',
  'Claude',
  'Gmail',
  'Slack',
  'Linear',
  'Notion',
  'Kimi',
  'API',
  'MCP',
  'OAuth',
]

function flattenYaml(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      result[fullKey] = value
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(
        result,
        flattenYaml(value as Record<string, unknown>, fullKey),
      )
    }
  }
  return result
}

function unflattenYaml(flat: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.')
    let current = result
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {}
      }
      current = current[parts[i]] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
  }
  return result
}

async function translateKeys(
  keys: Record<string, string>,
  targetLang: string,
  targetName: string,
): Promise<Record<string, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is required. Set it before running.',
    )
  }

  const client = new Anthropic({ apiKey })

  const keysText = Object.entries(keys)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Translate the following UI strings from English to ${targetName} (${targetLang}).

These are for a browser extension called BrowserOS — an AI-powered browser assistant.

Rules:
- Keep translations concise — they must fit in the same UI space as the English text.
- Preserve $1, $2 substitution placeholders exactly as-is.
- Do NOT translate these proper nouns: ${PRESERVE_TERMS.join(', ')}
- Return ONLY a valid JSON object mapping keys to translated strings. No markdown, no explanations.

Keys to translate:
${keysText}`,
      },
    ],
  })

  const text =
    response.content[0].type === 'text' ? response.content[0].text : ''

  // Extract JSON from response (handle potential markdown wrapping)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error(`Failed to parse translation response for ${targetLang}`)
  }

  return JSON.parse(jsonMatch[0]) as Record<string, string>
}

async function main() {
  const args = process.argv.slice(2)
  const langArg = args.find((a) => a.startsWith('--lang='))
  const dryRun = args.includes('--dry-run')
  const targetLang = langArg?.split('=')[1]

  // Read source locale
  const sourcePath = join(LOCALES_DIR, `${SOURCE_LOCALE}.yml`)
  if (!existsSync(sourcePath)) {
    console.error(`Source locale not found: ${sourcePath}`)
    process.exit(1)
  }

  const sourceYaml = parseYaml(readFileSync(sourcePath, 'utf-8')) as Record<
    string,
    unknown
  >
  const sourceFlat = flattenYaml(sourceYaml)

  const locales = targetLang
    ? { [targetLang]: TARGET_LOCALES[targetLang] || targetLang }
    : TARGET_LOCALES

  for (const [locale, langName] of Object.entries(locales)) {
    console.log(`\n--- ${langName} (${locale}) ---`)

    const targetPath = join(LOCALES_DIR, `${locale}.yml`)
    let existingFlat: Record<string, string> = {}

    if (existsSync(targetPath)) {
      const existingYaml = parseYaml(
        readFileSync(targetPath, 'utf-8'),
      ) as Record<string, unknown>
      existingFlat = flattenYaml(existingYaml)
    }

    // Find keys that need translation (new or changed in source)
    const keysToTranslate: Record<string, string> = {}
    for (const [key, value] of Object.entries(sourceFlat)) {
      if (!existingFlat[key]) {
        keysToTranslate[key] = value
      }
    }

    // Find keys to remove (no longer in source)
    const keysToRemove = Object.keys(existingFlat).filter(
      (key) => !sourceFlat[key],
    )

    if (
      Object.keys(keysToTranslate).length === 0 &&
      keysToRemove.length === 0
    ) {
      console.log('  ✓ Up to date — no changes needed')
      continue
    }

    console.log(
      `  ${Object.keys(keysToTranslate).length} key(s) to translate, ${keysToRemove.length} key(s) to remove`,
    )

    if (dryRun) {
      if (Object.keys(keysToTranslate).length > 0) {
        console.log('  New/changed keys:')
        for (const key of Object.keys(keysToTranslate)) {
          console.log(`    + ${key}`)
        }
      }
      if (keysToRemove.length > 0) {
        console.log('  Removed keys:')
        for (const key of keysToRemove) {
          console.log(`    - ${key}`)
        }
      }
      continue
    }

    // Translate new keys
    let translated: Record<string, string> = {}
    if (Object.keys(keysToTranslate).length > 0) {
      console.log('  Translating...')
      translated = await translateKeys(keysToTranslate, locale, langName)
      console.log(`  ✓ Translated ${Object.keys(translated).length} key(s)`)
    }

    // Merge: existing (preserving human edits) + new translations - removed keys
    const merged = { ...existingFlat, ...translated }
    for (const key of keysToRemove) {
      delete merged[key]
    }

    // Validate
    const missingPlaceholders: string[] = []
    for (const [key, value] of Object.entries(merged)) {
      const sourcePlaceholders = (sourceFlat[key] || '').match(/\$\d+/g) || []
      const translatedPlaceholders = value.match(/\$\d+/g) || []
      if (sourcePlaceholders.length !== translatedPlaceholders.length) {
        missingPlaceholders.push(key)
      }
    }
    if (missingPlaceholders.length > 0) {
      console.warn(
        `  ⚠ Placeholder mismatch in: ${missingPlaceholders.join(', ')}`,
      )
    }

    // Write
    const nestedYaml = unflattenYaml(merged)
    const yamlStr = stringifyYaml(nestedYaml, { lineWidth: 0 })
    writeFileSync(targetPath, yamlStr, 'utf-8')
    console.log(`  ✓ Written to ${targetPath}`)
  }

  console.log('\nDone!')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
