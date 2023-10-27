import { build } from "esbuild";
import p from './package.json' assert { type: "json" };

const sharedConfig = {
  bundle: true,
  minify: false,
  platform: 'node',
  external: Object.keys(p.dependencies).concat(Object.keys(p.peerDependencies)),
};
await build({
    entryPoints: ["src/index.ts"],
    ...sharedConfig,
    outfile: "dist/index.cjs",
})
await build({
    entryPoints: ["src/index.ts"],
    ...sharedConfig,
    format: "esm",
    outfile: "dist/index.mjs",
})
