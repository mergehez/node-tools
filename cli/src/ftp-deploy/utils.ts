import fs from 'node:fs';
import fsPath from 'node:path';
import chalk from 'chalk';
import ignore from 'ignore';
import defaultIgnores from './default.ftpignore';
import path from 'node:path';
import { execSync } from 'child_process';

export const deployerPathBase = './storage/deployer/';
export const deployerPathData = deployerPathBase + 'data/';
export const deployerPathManifest = deployerPathBase + 'manifest.json';
export type Manifest = Record<string, {
    time: number,
    size: number,
    isSymLink?: boolean,
}>

export function findInDir(dir: string, onFound: (p:string, s:fs.Stats) => void, exclude?: (path:string, name:string, stat:fs.Stats) => boolean) {
    dir = dir.replace(/\\/gi, "/");
    const files = fs.readdirSync(dir);
    for (const file of files) {
        let path = fsPath.join(dir, file).replace(/\\/gi, "/");
        const stat = fs.lstatSync(path);
        if(exclude && exclude(path, file, stat)){
            continue;
        }
        if (stat.isDirectory()) {
            findInDir(path, onFound, exclude);
            continue;
        }
        if (path.length > 0 && (path[0] === "/" || path[0] === "\\")) {
            path = path.substring(1);
        }
        onFound(path, stat);
    }
}

export function getIgnores(){
    if(!fs.existsSync('./.ftpignore')){
        console.log('created default ".ftpignore" file in the root directory. Have a look, edit if necessary and start again!');
        fs.writeFileSync('./.ftpignore', defaultIgnores);
        process.exit(1);
    }
    const ignores = fs.readFileSync('./.ftpignore').toString()
                    .split('\n')
                    .map(t=>t.trim())
                    .filter(t => t.length > 0 && !t.startsWith('#'));
    return ignore().add(ignores);
}

export function getFtpInfo(){
    if(!fs.existsSync('./.env')){
        console.log(chalk.red('No .env file found!'));
        process.exit(1);
    }
    const env = fs.readFileSync('./.env').toString().split('\n').filter(t => t.startsWith('FTP_')).map(t => t.substring(4));
    const ftp = {};
    for (const e of env) {
        const x = e.toLocaleLowerCase().split('=');
        ftp[x[0]] = e.substring(e.indexOf('=')+1);
    }
    for(const key of ['username', 'password', 'server', 'target_basepath']){
        if(!(key in ftp)){
            console.log(chalk.red('FTP_'+key.toUpperCase() + ' was not found in .env file!'));
            process.exit(1);
        }
    }
    return ftp as {
        username: string,
        password: string,
        server: string,
        target_basepath: string
    };
}