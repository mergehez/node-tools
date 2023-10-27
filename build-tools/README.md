
##  Install

```bash
npm i @mergehez/build -D 

# yarn 
yarn add @mergehez/build -D

# pnpm 
pnpm add @mergehez/build -D
```

## Usage

Add `mdi.vitePlugin` plugin to `vite.config.js / vite.config.ts` and configure it:

```ts
// vite.config.js / vite.config.ts
import mdi from '@mergehez/build'

export default {
  plugins: [
    mdi.vitePlugin([
        {
            target: 'assets/ics.scss', // the content of this file will be auto-generated. It should never be edited manually!
            mdiIcons: [
                'check',
                'person:two-tone',
                'info:round'
            ],
            watch: {
                directory: 'assets/svg', // new files inside these directory will be added to 'target' (only files with defined 'extensions')
                extensions: ['svg'],
            },
        }
    ])
  ]
}
```

## License

[MIT](./LICENSE) License &copy; 2023-PRESENT [Mazlum Ozdogan](https://github.com/mergehez)