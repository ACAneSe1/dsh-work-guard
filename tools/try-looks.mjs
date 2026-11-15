import { looksLikeVerify } from '../lib/verify-result.js'

const re = /gradlew|npm(\s|\.cmd\s+)(run\s+)?(test|build)/iu
const cases = [
  'npm test',
  'npm test -- --reporter=dot',
  'node build-fail.js --command "npm test"',
  'echo npm test',
  'pwsh -Command "npm test"',
]

for (const command of cases) {
  console.log(JSON.stringify(command), '->', looksLikeVerify(command, re))
}
