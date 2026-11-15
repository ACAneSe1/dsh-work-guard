import { writeTargetsOf } from '../lib/paths.js'

const cases = [
  'Set-Content -Path "C:\\proj\\x.ts" -Value 1',
  'Add-Content -Path ./y.ts -Value 2',
  'echo hi > C:\\proj\\z.ts',
  'Get-Content a | tee -FilePath C:\\proj\\w.ts',
  'Set-Content -Path $null -Value 1',
  'npm test > $null',
  'Set-Content -Path "$env:TEMP\\a.ts" -Value 1',
]

for (const command of cases) {
  console.log(JSON.stringify(command), '->', JSON.stringify(writeTargetsOf(command, 'E:\\base')))
}

