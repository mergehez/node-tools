import fs from 'node:fs';
import fsPath from 'node:path'
import chalk from 'chalk';
import defaultGlobalConfig from './default-ftp-deploy.yml';
import YAML from 'yaml'
import { NodeSSH } from 'node-ssh';
import { parseEnv } from '../cli_utils';
import { log, logError, logInfo, logWarning, stringFormat } from '../../../shared/src/helpers';

export const deployerPathBase = './storage/deployer/';
export const deployerPathData = deployerPathBase + 'data/';
export const deployerPathManifest = deployerPathBase + 'manifest.json';

const predefinedMethods = <const>[
    'local:prepare_deployer',
    'local:find_new_files',
    'local:copy_files_to_deployer',
    'local:check_dry_run',
    'local:save_deployer_status_tmp',
    'server:delete_dist_dirs',
    'local:upload_files',
    'server:unzip',
    'server:delete_zip',
    'local:dispose_ssh',
    'local:finish'
];
export type PredefinedMethods = typeof predefinedMethods[number];


export type Manifest = Record<string, {
    time: number,
    size: number,
    isSymLink?: boolean,
}>
export type Credentials = {
    username: string,
    password: string,
}

export type EnvCredentials = Credentials & {
    server: string,
    target_basepath: string,
}

export type StepShell = {
    command: string,
    args?: any[],
    message: string,
    ignore_error?: boolean,
    ignore_stdout?: boolean,
}

export type Step = { predefined: PredefinedMethods }
                 | { shell: StepShell }
                 | { log: string }
                 | { ssh_shell: StepShell };

export type Config = {
    host: string,
    target_basepath: string,
    ftp: Credentials,
    ssh?: Credentials,
    zip?: 'always' | 'if_ssh',
    dist_dirs?: string[],
    ignores: string[],
}
export type DeployYaml = {
    config: Config,
    steps: {
        local: Step[],
        server: Step[],
    }
}

export function parseGlobalConfig() {
    if (!fs.existsSync('ftp-deploy.yml')) {
        const ftp = getFtpInfoFromEnv();
        const ssh = getSshInfoFromEnv(ftp);
        const content = defaultGlobalConfig
            .replace('$SERVER$', ftp?.server || '')
            .replace('$TARGET_BASEPATH$', ftp?.target_basepath || '')
            .replace('$FTP_USERNAME$', ftp?.username || '')
            .replace('$FTP_PASSWORD$', ftp?.password || '')
            .replace('$SSH_USERNAME$', ssh?.username || '')
            .replace('$SSH_PASSWORD$', ssh?.password || '');
        fs.writeFileSync('ftp-deploy.yml', content);
        logInfo('\ncreated default "ftp-deploy.yml" file in the root directory. Have a look, edit if necessary and start again!');
        logWarning('Do NOT forget to add the file to .gitignore!');
        process.exit(1);
    }
    const configStr = fs.readFileSync('./ftp-deploy.yml', 'utf8')
        .split('\n')
        .filter(t => t.trim().length > 0 && !t.trim().startsWith('#'))
        .join('\n');
    const config = YAML.parse(configStr) as DeployYaml;
    config.steps.local ??= [];
    config.steps.server ??= [];

    config.steps.local = validateSteps(config, 'local')
    config.steps.server = validateSteps(config, 'server')

    // console.log(config.steps.local);
    return config;
}

function validateSteps(yaml: DeployYaml, key: 'local' | 'server') {
    const steps = yaml.steps[key];
    let invalidPredefined = (steps.filter(t => 'predefined' in t) as { predefined: string }[])
        .find(t => !(predefinedMethods as any).includes(t.predefined));
    if (invalidPredefined) {
        logError(`"${invalidPredefined.predefined}" from "steps.${key}" is not a valid predefined function`);
        process.exit(1);
    }
    for (let i = 0; i < steps.length; i++) {
        const sh = steps[i];
        const key2 = ['shell', 'ssh_shell'].find(t => t in sh);
        if (key2){
            steps[i][key2].command = formatCommand(yaml.config, sh[key2]);
            if(steps[i][key2].message){
                steps[i][key2].message = sh[key2].message.replace('$command', sh[key2].command);
            }
        }
    }

    return steps;
}


export function getFtpInfoFromEnv() {
    const ftp = parseEnv('FTP_', false, true);
    // validateEnvRecord(ftp, 'FTP_', ['username', 'password', 'server', 'target_basepath']);
    return ftp as EnvCredentials;
}

export function getSshInfoFromEnv(ftpInfo: EnvCredentials): Credentials | null {
    const ssh = parseEnv('SSH_', false, true);
    if ('username' in ssh == false || 'password' in ssh == false)
        return null;

    if ('server' in ssh == false)
        ssh['server'] = ftpInfo?.server;
    ssh['target_basepath'] = ftpInfo?.target_basepath;
    return ssh as EnvCredentials;
}

export async function runShellSsh(ssh: NodeSSH, cmd: string, ignoreErrors = false) {
    if (process.argv.includes('--act')) {
        log(chalk.cyan(`->ACT runShellSsh: ${cmd}`))
        return;
    }
    try {
        await ssh.execCommand(cmd, {
            onStderr: c => {
                if (ignoreErrors)
                    return null;
                logError(c.toString());
                ssh.dispose();
                process.exit(1);
            }
        });
    } catch (error) {
        if (ignoreErrors)
            return;
        logError(error.toString());
        ssh.dispose();
        process.exit(1);
    }
}

export function formatCommand(config: Config, shell: StepShell) {
    if (!shell.args || shell.args.length == 0)
        return shell.command;
    const args: string[] = [];
    for (let a of shell.args) {
        if (typeof a !== 'string' || !a.startsWith('$config.'))
            args.push(a.toString());
        else {
            a = a.substring(8);
            if (a in config)
                args.push(config[a] as string);
            else {
                logError(`"${shell.command}" has "${a}" as argument but it doesn't exist in config!`);
                process.exit(1);
            }
        }
    }
    return stringFormat(shell.command, args);
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