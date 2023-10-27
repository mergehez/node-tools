#!/usr/bin/env node

import fs from 'node:fs'
import fsPath from 'node:path'
import {deployerPathData, deployerPathManifest, findInDir, getFtpInfo, getIgnores, Manifest} from './utils'
import chalk from 'chalk';
import { runShell } from '../cli_utils';

const ftp = getFtpInfo();

runShell('php artisan route:cache || exit 2', chalk.blue('- artisan route:cache'));
runShell('php artisan cache:clear;', chalk.blue('- artisan cache:clear'));
runShell('php artisan config:clear;', chalk.blue('- artisan config:clear'));
runShell('php artisan view:clear;', chalk.blue('- artisan view:clear'));
runShell('php artisan optimize:clear;', chalk.blue('- artisan optimize:clear'));
runShell('php artisan debugbar:clear;', chalk.blue('- artisan debugbar:clear'));
runShell('rm -r public/build/;', chalk.blue('- deleting public/build on local machine'));
runShell('npm run build || exit 2;', chalk.blue('- npm run build'));
console.log('\n');

if(fs.existsSync(deployerPathData))
    fs.rmSync(deployerPathData, {recursive: true, force: true});

let lastFiles:Manifest|undefined; 
try {
    if(fs.existsSync(deployerPathManifest))
        lastFiles = JSON.parse(fs.readFileSync(deployerPathManifest).toString());
} catch (error) {
    lastFiles = undefined;
    console.error(chalk.red("Couldn't parse manifest.json"));
}

const newFiles:Manifest = {};

const ignores = getIgnores();
findInDir('./', (path, stat) => {
    newFiles[path] = {
        size: stat.size, 
        time: stat.mtimeMs,
        isSymLink: stat.isSymbolicLink(),
    };
}, (path: string, _: string, stat) => {
    if(stat.isSymbolicLink()) 
        return true;

    if(ignores.ignores(path))
        return true;

    return false;
});

if(!fs.existsSync(deployerPathData))
    fs.mkdirSync(deployerPathData, {recursive: true});

let printedBuild = false;

console.log('FILES TO UPLOAD:');
for (const src in newFiles) {
    if(lastFiles && src in lastFiles){
        const newFile = newFiles[src];
        const last = lastFiles[src];
        if(last.size == newFile.size && last.time == newFile.time)
            continue;
    }
    if(src.startsWith('public/build/')){
        if(!printedBuild)
            console.log(chalk.green('- public/build/*'));
        printedBuild = true;
    }else{
        console.log(chalk.green('- ' + src));
    }
    const dest = fsPath.join(deployerPathData, src);
    if(!fs.existsSync(dest))
        fs.mkdirSync(fsPath.parse(dest).dir, {recursive: true});
    fs.copyFileSync(src, dest);
}
if(Object.keys(newFiles).length === 0){
    console.log(chalk.red('\n There is no new file!'));
    process.exit();
}

fs.writeFileSync(deployerPathManifest + '.tmp', JSON.stringify(newFiles, null, 2));

let ftpcmd = `set ftp:ssl-allow no; rm -r ${ftp.target_basepath}/public/build/ ${ftp.target_basepath}/public/hot; bye;`;
ftpcmd = `lftp ftp://${ftp.username}:${ftp.password}@${ftp.server} -e "${ftpcmd}"`
try {
    runShell(ftpcmd, chalk.blue('\n- deleting "public/build/" and "public/hot" on server'), true);
} catch (error) {
    console.log(error)
}

try {
    console.log(chalk.blue('\n Uploading files:'));
    runShell(`ncftpput -R -v -u "${ftp.username}" -p "${ftp.password}" ${ftp.server} /${ftp.target_basepath} ${deployerPathData}/*`);
    fs.writeFileSync(deployerPathManifest, JSON.stringify(newFiles, null, 2));
    fs.rmSync(deployerPathManifest + '.tmp');
} catch (error) {
    console.log(error)
    process.exit(1);
}

console.log(chalk.green('\n🎉 FINISHED SUCCESSFULLY 🎉'));