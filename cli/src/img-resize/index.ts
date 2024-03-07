#!/usr/bin/env node
import { createCommonJS } from 'mlly'
const { require } = createCommonJS(import.meta.url)
import { extname } from "path";
import fs from "node:fs";
import { writeFileSync } from "fs";
// import yargs from "yargs";
const yargs = require('yargs') // had to do so otherwise it was throwing error

import { resizeUntilMaxSize } from "./utils";
import { findInDir, logError, logInfo, logSuccess } from '../../../shared/src/helpers';
import Mexp from 'math-expression-evaluator';

const options = await yargs
    .scriptName("img-resize")
    .usage("Usage: $0 --input image.jpeg --out small.jpeg --width 600")
    .option("pattern", { alias: "p", describe: "Pattern for multiple images", type: "string" })
    .option("rename", { alias: "r", describe: "Pattern for renaming. Use [name] and [ext] placeholders!", type: "string" })
    .option("input", { alias: "i", describe: "Path to input image", type: "string" })
    .option("output", { alias: "o", describe: "Path to output image", type: "string" })
    .option("width", { alias: "w", describe: "Width [px]", type: "number" })
    .option("height", { alias: "h", describe: "Height [px]", type: "number" })
    .option("max-width", { alias: "mw", describe: "Max width [px]", type: "number" })
    .option("max-height", { alias: "mh", describe: "Max height [px]", type: "number" })
    .option("quality", { alias: "q", describe: "Quality from 1 to 100", type: "number", default: 80})
    .option("scale", { alias: "s", describe: "Scale width/height", type: "number", default: 1})
    .option("smooth", { describe: "Smoother resize processing", type: "boolean", default: true })
    .option("max-size", { describe: "Max size in bytes" })
    .help()
    .argv;

if(options.maxSize){
    if(typeof options.maxSize === 'string'){
        try {
            const mexp = new Mexp();
            options.maxSize = mexp.eval(options.maxSize);
        } catch (error) { }
    }
    
    if(typeof options.maxSize !== 'number'){
        logError('Max size must be a number or a math expression like 1024*200, 1024/2 etc..');
        process.exit(1);
    }
}

let input = options.input;
let output = options.output;

if(input.startsWith('.') && input.split('.').length == 2){
    input = '(.*)' + input;
}
if(!output.includes('[name]') && (output.startsWith('-') || output.startsWith('_'))){// || "0123456789".includes(output[0]))){
    output = '[name]' + output;
}
if(!output.includes('[name]')){
    logError('Output path must contain [name] placeholder!');
    process.exit(1);        
}
if(!output.includes('.')){
    logError('Output path must contain . (dot) at least once!');
    process.exit(1);        
}

const files: {
    src: string,
    dest: string,
}[] = [];
findInDir('./', (p, s) => {
    let ext = extname(p);
    const name = p.replace(ext, '');
    ext = ext.startsWith('.') ? ext.substring(1) : ext;

    files.push({ 
        src: p, 
        dest: output.replace('[name]', name).replace('[ext]', ext)
    });
}, (p: string, n: string, s: fs.Stats) => {
    if(s.isDirectory())
        return true;
    if(!['.png', '.jpg', '.jpeg'].includes(extname(n)))
        return true;
    return !(new RegExp(input).test(n));
});

for (const file of files) {
    logInfo(`\n- Resizing: ${file.src}`);
    var res = await resizeUntilMaxSize(file.src, options, options["max-size"]);
    const outputImage = res.buffer;
    const orig = res.original_size;
    const fin = res.final_size;

    const finKB = Math.round((outputImage.length / 1024) * 100) / 100;
    const origKB = Math.round((fs.statSync(file.src).size / 1024) * 100) / 100;
    logSuccess(`      from: ${file.src} (${orig.height}x${orig.width} ${origKB} KB)`);
    logSuccess(`        to: ${file.dest} (${fin.height}x${fin.width} ${finKB} KB)`);
    writeFileSync(file.dest, outputImage);
}