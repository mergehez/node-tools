#!/usr/bin/env node
import { createCommonJS } from 'mlly'
const { require } = createCommonJS(import.meta.url)
import { extname } from "path";
import fs from "node:fs";
import { writeFileSync } from "fs";
// import yargs from "yargs";
const yargs = require('yargs') // had to do so otherwise it throws exception

import { resizeUntilMaxSize } from "./utils";
import { findInDir, logError, logInfo, logSuccess } from '../../../shared/src/helpers';

const options = await yargs
    .scriptName("img-resize")
    .usage("Usage: $0 --input image.jpeg --out small.jpeg --width 600")
    // .option("pattern", { alias: "p", describe: "Pattern for multiple images", type: "string" })
    // .option("rename", { alias: "r", describe: "Pattern for renaming. Use [name] and [ext] placeholders!", type: "string" })
    .option("input", { alias: "i", describe: "Regex pattern to find files. [A-9] will be replaced as [A-z0-9]", type: "string" })
    .option("output", { alias: "o", describe: "Rename pattern", type: "string" })
    .option("width", { alias: "w", describe: "Width [px]", type: "number" })
    .option("height", { alias: "h", describe: "Height [px]", type: "number" })
    .option("max-width", { alias: "mw", describe: "Max width [px]", type: "number" })
    .option("max-height", { alias: "mh", describe: "Max height [px]", type: "number" })
    .option("quality", { alias: "q", describe: "Quality from 1 to 100", type: "number", default: 80 })
    .option("scale", { alias: "s", describe: "Scale width/height", type: "number", default: 1 })
    .option("smooth", { describe: "Smoother resize processing", type: "boolean", default: true })
    .option("max-size", { describe: "Max size in bytes", type: "string" })
    .demandOption(["input", "output"], "Please provide input and output arguments")
    .help()
    .argv;

let maxSize = options.maxSize;
if (maxSize) {
    let multiply = 1;
    if (typeof maxSize === 'string') {
        maxSize = maxSize.toLowerCase().trim();
        if (maxSize.endsWith('kb')) {
            multiply = 1024;
            maxSize = maxSize.substring(0, maxSize.length - 2).trim();
        } else if (maxSize.endsWith('k')) {
            multiply = 1024;
            maxSize = maxSize.substring(0, maxSize.length - 1).trim();
        } else if (maxSize.endsWith('mb')) {
            multiply = 1024 * 1024;
            maxSize = maxSize.substring(0, maxSize.length - 2).trim();
        }
        if (/^[0-9]+$/.test(maxSize)) {
            maxSize = parseFloat(maxSize);
        } else if (maxSize.includes('*')) {
            maxSize = maxSize.split('*').reduce((acc: number, num: string) => acc * parseInt(num), 1);
        } else if (maxSize.includes('/')) {
            const nums:string[] = maxSize.split('/');
            const first = nums.shift();
            maxSize = nums.reduce((acc: number, num: string) => acc / parseInt(num), parseInt(first));
        }
    }
    if (typeof maxSize !== 'number') {
        logError('Max size must be a number or a math expression like 200kb, 0.2mb, 1024*200, 1024/2 etc..');
        process.exit(1);
    }
    maxSize = parseInt((maxSize * multiply).toString());
}

let input = options.input.replaceAll('[A-9', '[A-z0-9');
let output = options.output;

if (input.startsWith('.') && input.split('.').length == 2) {
    input = '(.*)' + input;
}
if (!output.includes('[name]') && (output.startsWith('-') || output.startsWith('_'))) {// || "0123456789".includes(output[0]))){
    output = '[name]' + output;
}
if (!output.includes('[name]')) {
    logError('Output path must contain [name] placeholder!');
    process.exit(1);
}
if (!output.includes('.')) {
    logError('Output path must contain . (dot) at least once!');
    process.exit(1);
}

const files: {
    src: string,
    dest: string,
}[] = [];

findInDir('./', (path) => {
    let ext = extname(path);
    const name = path.replace(ext, '');
    ext = ext.startsWith('.') ? ext.substring(1) : ext;

    files.push({
        src: path,
        dest: output.replace('[name]', name).replace('[ext]', ext)
    });
}, (_, n: string, s: fs.Stats) => {
    if (s.isDirectory())
        return true;
    if (!['.png', '.jpg', '.jpeg'].includes(extname(n)))
        return true;
    return !(new RegExp(input).test(n));
});

for (const file of files) {
    logInfo(`\n- Resizing: ${file.src}`);
    const res = await resizeUntilMaxSize(file.src, options, maxSize);
    const outputImage = res.buffer;
    const orig = res.original_size;
    const fin = res.final_size;

    const finKB = Math.round((outputImage.length / 1024) * 100) / 100;
    const origKB = Math.round((fs.statSync(file.src).size / 1024) * 100) / 100;
    logSuccess(`      from: ${file.src} (${orig.height}x${orig.width} ${origKB} KB)`);
    logSuccess(`        to: ${file.dest} (${fin.height}x${fin.width} ${finKB} KB)`);
    writeFileSync(file.dest, outputImage);
}