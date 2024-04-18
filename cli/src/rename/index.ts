#!/usr/bin/env node
import { createCommonJS } from 'mlly'
const { require } = createCommonJS(import.meta.url)
import fs from "node:fs";
// import yargs from "yargs";
const yargs = require('yargs') // had to do so otherwise it was throwing error

import { findInDir, logInfo, logSuccess } from '../../../shared/src/helpers';
import chalk from 'chalk';

const options = await yargs
    .scriptName("rename")
    .usage("Usage: $0 --in \"([A-z0-9]+).jpg\"  --out \"$1-[index].jpg\" --width 600")
    .option("input", { alias: "i", describe: "Regex pattern to find files. [A-9] will be replaced as [A-z0-9]", type: "string" })
    .option("output", { alias: "o", describe: "Rename pattern. (You can use [i] (index) and [pos] (position) as placeholder)", type: "string" })
    .option("dry", { describe: "Show what would be renamed, but don't rename them.", type: "boolean", default: false })
    .demandOption(['input', 'output'], 'Please provide both input and output pattern')
    .help()
    .argv;

let input = options.input.replaceAll('[A-9', '[A-z0-9');

let output = options.output;

const files: string[] = [];
findInDir({
    baseDir: './',
    onFound: (data) => {
        // const m = new RegExp(input).exec(data.path);
        files.push(data.path);
    },
    objectCreator: (data) => {
        if (data.stat.isDirectory() || !new RegExp(input).test(data.name))
            return null;
        return data;
    }
})

for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const m = new RegExp(input).exec(file);
    let newName = output.replace('[i]', i.toString()).replace('[pos]', (i + 1).toString());
    for (let j = 1; j < m.length; j++) {
        if (newName.includes(`$trim(${j})`)) {
            m[j] = m[j].trim();
            newName = newName.replace(`$trim(${j})`, m[j]);
        }

        // trim text from left and right
        let toSplit = `$trim(${j},`;
        if (newName.includes(toSplit)) {
            const split = newName.split(toSplit);
            const split2 = split[1].trim().split(')');
            console.log(split, split2);
            const toTrim = split2[0] || ' '; // if nothing was provided, default to space
            while (m[j].startsWith(toTrim) || m[j].endsWith(toTrim))
                m[j] = m[j]
                    .replace(new RegExp(`^${toTrim}`), '')
                    .replace(new RegExp(`${toTrim}$`), '');
            newName = split[0] + m[j] + split2[1];
        }

        // trim text from left
        toSplit = `$triml(${j},`;
        if (newName.includes(toSplit)) {
            const split = newName.split(toSplit);
            const split2 = split[1].trim().split(')');
            const toTrim = split2[0];
            while (m[j].startsWith(toTrim))
                m[j] = m[j].replace(new RegExp(`^${toTrim}`), '');
            newName = split[0] + m[j] + split2[1];
        }

        // trim text from right
        toSplit = `$trimr(${j},`;
        if (newName.includes(toSplit)) {
            const split = newName.split(toSplit);
            const split2 = split[1].trim().split(')');
            const toTrim = split2[0];
            while (m[j].endsWith(toTrim))
                m[j] = m[j].replace(new RegExp(`${toTrim}$`), '');
            newName = split[0] + m[j] + split2[1];
        }

        newName = newName.replace(`$${j}`, m[j]);
    }
    if (newName === file) {
        logInfo(`- renamed file is same as original: ${file}`);
        continue;
    }
    if (options.dry) {
        console.log('Would rename ' + chalk.yellow(file) + ' to ' + chalk.yellow(newName));
        // logInfo(`Would rename ${file} to ${newName}`);
    } else {
        fs.renameSync(file, newName);
        logSuccess(`Renamed ${file} to ${newName}`);
    }
}