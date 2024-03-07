import fs from 'node:fs';
import fsPath from 'node:path'
import prompts from 'prompts'
import chalk from 'chalk';
import defaultConfigIIS from './default-ftp-deploy-iis.yml';
import defaultConfigLaravel from './default-ftp-deploy-laravel.yml';
import YAML from 'yaml'
import { NodeSSH } from 'node-ssh';
import { parseEnv } from '../cli_utils';
import { log, logError, logInfo, logSuccess, logWarning, stringFormat } from '../../../shared/src/helpers';

const predefinedMethods = <const>[
    'local:prepare_deployer',
    'local:find_new_files',
    'local:copy_files_to_deployer',
    'local:check_dry_run',
    'local:save_deployer_status_tmp',
    'server:delete_dist_dirs',
    'local:upload_files',
    'local:sleep',
    'server:restart_iis_site',
    'server:unzip',
    'server:delete_zip',
    'local:dispose_ssh',
    'local:finish'
];

export type PredefinedMethods = typeof predefinedMethods[number] | ({
    method: typeof predefinedMethods[number],
} & Record<string, string>);


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

export const ProjectTypes = {
    iis: 'iis',
    laravel: 'laravel',
}

export type ProjectType = keyof typeof ProjectTypes;
export type Config = {
    host: string,
    deployer_basepath?: string,
    source_basepath?: string,
    target_basepath: string,
    ftp: Credentials,
    ssh?: Credentials,
    zip?: 'always' | 'if_ssh',
    dist_dirs?: string[],
    ignores: string[],
    project_type?: ProjectType,
} & Record<string, string>;

export type DeployYaml = {
    config: Config,
    steps: Step[],
    deployer: {
        path_base: string,
        path_data: string,
        path_manifest: string,
    }
}
export let ftpDeployYamlPath = "./ftp-deploy.yml";
export async function parseGlobalConfig() {
    for (let i = 0; i < process.argv.length; i++) {
        if (process.argv[i].startsWith('--config')) {
            ftpDeployYamlPath = process.argv[i].split('=')[1];
            if (!fs.existsSync(ftpDeployYamlPath)) {
                logError(`Config file "${ftpDeployYamlPath}" does not exist!`);
                process.exit(1);
            }
            break;
        }
    }

    await checkFtpDeployFile();
    const ftp = getFtpInfoFromEnv();
    const ssh = getSshInfoFromEnv(ftp);


    const configStr = fs.readFileSync(ftpDeployYamlPath, 'utf8')
        .split('\n')
        .filter(t => t.trim().length > 0 && !t.trim().startsWith('#'))
        .join('\n')
        .replace('$env.FTP_SERVER$', ftp.server)
        .replace('$env.FTP_USERNAME$', ftp.username)
        .replace('$env.FTP_PASSWORD$', ftp.password)
        .replace('$env.SSH_USERNAME$', ssh?.username ?? '')
        .replace('$env.SSH_PASSWORD$', ssh?.password ?? '');

    const config = YAML.parse(configStr) as DeployYaml;
    
    config.steps = validateSteps(config);

    config.config.source_basepath ??= './';
    config.config.ftp
    config.config.ssh = ssh;

    let depBasePath = config.config.deployer_basepath ??= './deployer/';
    if (depBasePath[depBasePath.length - 1] !== '/')
        depBasePath += '/';
    config.deployer = {
        path_base: depBasePath,
        path_data: depBasePath + 'data/',
        path_manifest: depBasePath + 'manifest.json',
    }
    return config;
}

function validateSteps(yaml: DeployYaml) {
    if(!yaml.steps){
        return yaml.steps = [];
    }

    const validatePredefined = (t: PredefinedMethods) => {
        let method: string;
        if (typeof t === 'object') {
            if (!('method' in t))
                return false;
            method = t.method;
        } else
            method = t;

        return (predefinedMethods as any).includes(method);
    }

    let invalidPredefined = (yaml.steps.filter(t => 'predefined' in t) as { predefined: PredefinedMethods }[])
        .find(t => !validatePredefined(t.predefined));

    if (invalidPredefined) {
        logError(`"${invalidPredefined.predefined}" is not a valid predefined function`);
        process.exit(1);
    }
    for (let i = 0; i < yaml.steps.length; i++) {
        const sh = yaml.steps[i];
        const key2 = ['shell', 'ssh_shell'].find(t => t in sh);
        if (key2) {
            yaml.steps[i][key2].command = formatCommand(yaml.config, sh[key2]);
            if (yaml.steps[i][key2].message) {
                yaml.steps[i][key2].message = sh[key2].message.replace('$command', sh[key2].command);
            }
        }
    }

    return yaml.steps;
}


async function checkFtpDeployFile() {
    if (fs.existsSync(ftpDeployYamlPath))
        return;

    const shouldCreateNew = (await prompts({
        type: 'confirm',
        name: 'value',
        message: 'No config file for ftp-deploy found in the root directory. Do you want to create a default one? (default: Yes)',
        initial: true,
    })).value;


    if (!shouldCreateNew)
        process.exit(1);

    const os = (await prompts({
        type: 'select',
        name: 'os',
        message: 'What is the type of your project?',
        choices: [
            { title: 'IIS (Windows)', value: ProjectTypes.iis },
            { title: 'Laravel (Linux)', value: ProjectTypes.laravel },
        ]
    })).os as ProjectType;

    fs.writeFileSync(ftpDeployYamlPath, os === ProjectTypes.iis ? defaultConfigIIS : defaultConfigLaravel);
    
    const contentToAddToEnv = 'FTP_SERVER=\nFTP_USERNAME=\nFTP_PASSWORD=\nSSH_USERNAME=\nSSH_PASSWORD=\n';
    if(!fs.existsSync('.env')){
        fs.writeFileSync('.env', contentToAddToEnv);
        logWarning('\n- Created default ".env" file in the root directory. Fill in all information.');
    }else{
        const content = fs.readFileSync('.env').toString();
        if(!content.includes('FTP_') && !content.includes('SSH_')){
            fs.appendFileSync('.env', contentToAddToEnv);
            logWarning('\n- Added default "FTP_" and "SSH_" variables to the existing ".env" file. Fill in all information.');
        }
    }
    logWarning('- Created default "ftp-deploy.yml" file in the root directory. Have a look, edit if necessary and start again!');
    
    if(fs.existsSync('.gitignore')){
        const content = fs.readFileSync('.gitignore').toString();
        if(!content.includes('.env') && (await prompts({
            type: 'confirm',
            name: 'value',
            message: 'Your .gitignore does NOT contain ".env". Do you want to add it? (Highly recommended) (default: Yes)',
            initial: true,
        })).value){
            fs.appendFileSync('.gitignore', '\n.env')
            logWarning('- Added ".env" to .gitignore');
        }
    }else{
        const shouldCreateNew = (await prompts({
            type: 'confirm',
            name: 'value',
            message: 'No ".gitignore" file found in the root directory. Do you want to create a default one? (default: Yes)',
            initial: true,
        })).value;
        if(shouldCreateNew){
            fs.writeFileSync('.gitignore', '.env\nnode_modules\ndeployer');
            logWarning('- Created default ".gitignore" file in the root directory. Added ".env" to it');
        }
    }

    process.exit(1);
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
                logError(c.toString().trim() + ' (stderr)');
                ssh.dispose();
                process.exit(1);
            }
        });
    } catch (error) {
        if (ignoreErrors)
            return;
        logError(error.toString().trim() + ' (catch)');
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

export function findInDir(dir: string, onFound: (p: string, s: fs.Stats) => void, exclude?: (path: string, name: string, stat: fs.Stats) => boolean) {
    dir = dir.replace(/\\/gi, "/");
    const files = fs.readdirSync(dir);
    for (const file of files) {
        let path = fsPath.join(dir, file).replace(/\\/gi, "/");
        const stat = fs.lstatSync(path);
        if (exclude && exclude(path, file, stat)) {
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
