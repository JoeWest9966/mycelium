// Regenerate src/api/schema.d.ts from the hub's contract.
//
// The spec lives in the hypha repository, not here. Point HYPHA_DIR at a
// checkout; default is a sibling directory. Failing with an explanation beats
// openapi-typescript printing ENOENT for a path the reader has never seen.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const hypha = resolve(process.env.HYPHA_DIR ?? '../hypha')
const spec = resolve(hypha, 'api/openapi.yaml')

if (!existsSync(spec)) {
  console.error(
    `hypha's contract not found at ${spec}\n\n` +
      `  git clone https://github.com/JoeWest9966/hypha.git ${hypha}\n` +
      `  # or: HYPHA_DIR=/path/to/hypha npm run api:types\n`,
  )
  process.exit(1)
}

const check = process.argv.includes('--check')
const committed = resolve('src/api/schema.d.ts')
const out = check ? resolve('/tmp/mycelium-schema.d.ts') : committed

execFileSync('npx', ['openapi-typescript', spec, '-o', out], { stdio: 'inherit' })

if (check) {
  // A stale generated file type-checks fine against the spec the code was
  // written for, and fails at runtime against the hub. Compare bytes instead.
  const fresh = readFileSync(out, 'utf8')
  const old = existsSync(committed) ? readFileSync(committed, 'utf8') : ''
  if (fresh !== old) {
    console.error(
      '\nsrc/api/schema.d.ts is out of date with hypha/api/openapi.yaml.\n' +
        'Run `npm run api:types` and commit the result.\n',
    )
    process.exit(1)
  }
  console.log('api types match the contract')
}
