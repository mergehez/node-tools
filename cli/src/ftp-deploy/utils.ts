import fs from 'node:fs';
import fsPath from 'node:path';
import chalk from 'chalk';
import ignore from 'ignore';
import defaultIgnores from './default.ftpignore';
import path from 'node:path';
import { execSync } from 'child_process';
import { parseEnv, parseEnvToLines, validateEnvRecord } from '../cli_utils';

export const deployerPathBase = './storage/deployer/';
export const deployerPathData = deployerPathBase + 'data/';
export const deployerPathManifest = deployerPathBase + 'manifest.json';
export type Manifest = Record<string, {
    time: number,
    size: number,
    isSymLink?: boolean,
}>
export type FtpInfo = { 
    server: string, 
    username: string, 
    password: string, 
    target_basepath: string 
}

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
    const ftp = parseEnv('FTP_', false, true);
    validateEnvRecord(ftp, 'FTP_', ['username', 'password', 'server', 'target_basepath']);
    return ftp as FtpInfo;
}

export function getSshInfo(ftpInfo : FtpInfo): FtpInfo|null {
    const ssh = parseEnv('SSH_', false, true);
    if('username' in ssh == false || 'password' in ssh == false)
        return null;

    if('server' in ssh == false)
        ssh['server'] = ftpInfo.server;
    ssh['target_basepath'] = ftpInfo.target_basepath;
    return ssh as FtpInfo;
}