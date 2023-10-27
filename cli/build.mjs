import { build } from "esbuild";
import { readFileSync } from "fs"
// import p from './package.json' assert { type: "json" };

const pkg = JSON.parse( readFileSync( new URL('./package.json', import.meta.url) ).toString());

const sharedConfig = {
    bundle: true,
    minify: false,
    platform: 'node',
    format: 'esm',

    external: [
        ...Object.keys(pkg.dependencies),
        ...Object.keys(pkg.peerDependencies || {})
    ],
};

await build({
    ...sharedConfig,
    outfile: "dist/git-switch.mjs",
    entryPoints: ["src/git-switch/index.ts"],
});

await build({
    ...sharedConfig,
    outfile: "dist/phpmin.mjs",
    entryPoints: ["src/phpmin/index.ts"],
});

await build({
    ...sharedConfig,
    outfile: "dist/ftp-deploy.mjs",
    entryPoints: ["src/ftp-deploy/index.ts"],
    plugins: [ 
        {
            name: "ImportFtpIgnorePlugin",
            setup(build) {
                build.onLoad({ filter: /\.ftpignore$/ }, async (args) => {
                    return { loader: "text", contents: readFileSync(args.path).toString() }
                })
            }
        },
    ],
});
