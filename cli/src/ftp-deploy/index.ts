#!/usr/bin/env node

import fs from 'node:fs'
import fsPath from 'node:path'
import {deployerPathData, deployerPathManifest, findInDir, getFtpInfo, getIgnores, getSshInfo, Manifest} from './utils'
import chalk from 'chalk';
import JSZip from 'jszip';
import path from 'node:path';
import {NodeSSH} from 'node-ssh';
import { runShell } from '../cli_utils';

var startTime = performance.now()
const ignores = getIgnores();
const ftp = getFtpInfo();
await new Promise(resolve => setTimeout(resolve, 2001));
const sshInfo = getSshInfo(ftp);

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

const zip = new JSZip();
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
    if(sshInfo){
        zip.file(src, fs.readFileSync(src).toString());
    }else{
        if(!fs.existsSync(dest))
            fs.mkdirSync(fsPath.parse(dest).dir, {recursive: true});
        fs.copyFileSync(src, dest);
    }
}
if(Object.keys(newFiles).length === 0){
    console.log(chalk.red('\n There is no new file!'));
    process.exit();
}

if(sshInfo){
    const buffer = await zip.generateAsync({type:'nodebuffer',streamFiles:true})
    fs.writeFileSync(path.join(deployerPathData, 'archive.zip'), buffer);
    console.log(chalk.blue("\n-> Created archive.zip."));
}

if(process.argv.includes('--dry-run')){
    console.log('\n-> End of dry-run!');
    process.exit(0);
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
    console.log(chalk.blue('\n-> Uploading files:'));
    runShell(`ncftpput -R -v -u "${ftp.username}" -p "${ftp.password}" ${ftp.server} /${ftp.target_basepath} ${deployerPathData}/*`);
    fs.writeFileSync(deployerPathManifest, JSON.stringify(newFiles, null, 2));
    fs.rmSync(deployerPathManifest + '.tmp');
} catch (error) {
    console.log(error)
    process.exit(1);
}

if(sshInfo){
    console.log('\n-> Unzipping on the server using SSH...');
    try {
        const ssh = await new NodeSSH().connect({
            host: sshInfo.server,
            username: sshInfo.username,
            password: sshInfo.password,
        });

        const cdPath = `../www/wwwroot/${sshInfo.target_basepath}`;
        await ssh.execCommand(`cd ${cdPath} || { echo "'${cdPath}' doesn't exist"; exit 1; }; unzip -o archive.zip;`, {
            // onStdout: (c) => console.log(c.toString()),
            onStderr: c => {
                console.log(chalk.red(c.toString()));
                ssh.dispose();
                process.exit(1);
            }
        });
        ssh.dispose();
    } catch (error) {
        if(error.message?.includes('All configured authentication methods failed')){
            console.log(chalk.red('Invalid SSH credentials given!'))
            process.exit(1);
        }
        throw error;
    }
}

const execTime = (performance.now() - startTime).toFixed(0);
console.log(chalk.green(`\n🎉 FINISHED SUCCESSFULLY in ${execTime} ms 🎉`));