import fs from 'node:fs';

const files = fs.readdirSync('node_modules/@material-design-icons/svg/filled');
const list = files.filter(p => p.endsWith('.svg'))
                .map(p => "'"+p.replace('.svg','')+"'")
                .join(' | ');
fs.writeFileSync('src/mdi/mdi-icons.ts', `export type _InternalMdiIcon = ${list};`);