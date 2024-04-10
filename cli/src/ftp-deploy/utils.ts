import fs from 'node:fs';
import defaultConfigIIS from './default-ftp-deploy-iis.yml';
import defaultConfigLaravel from './default-ftp-deploy-laravel.yml';
import YAML from 'yaml'
import {parseEnv, promptConfirm, promptChoice, ShellProps} from '../cli_utils';
import {logError, logWarning, stringFormat} from '../../../shared/src/helpers';
import {DeployYaml, PredefinedMethods, ProjectTypes, ProjectType, EnvCredentials, Credentials, obsoleteMethods, predefinedMethods, _toString_Help} from './types';
import {EOL} from "node:os";

export let ftpDeployYamlPath = "./ftp-deploy.yml";

export async function parseGlobalConfig(): Promise<DeployYaml> {
    if (process.argv.includes('--help')) {
        console.log(_toString_Help);
        process.exit(0);
    }

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
    const ftpEnv = getFtpInfoFromEnv();
    const sshEnv = getSshInfoFromEnv(ftpEnv);

    // const str = fs.readFileSync(ftpDeployYamlPath, 'utf8');
    const configStr = fs.readFileSync(ftpDeployYamlPath, 'utf8')
        .split(EOL)
        .filter(t => t.trim().length > 0 && !t.trim().startsWith('#'))
        .join(EOL)
        .replace('${env.FTP_SERVER}', ftpEnv.server)
        .replace('${env.FTP_USERNAME}', ftpEnv.username)
        .replace('${env.FTP_PASSWORD}', ftpEnv.password)
        .replace('${env.SSH_USERNAME}', sshEnv.username)
        .replace('${env.SSH_PASSWORD}', sshEnv.password);

    const config = YAML.parse(configStr) as DeployYaml;

    const ftp = config.config.ftp;
    if (!('username' in ftp) || !('password' in ftp) || !('base_path' in ftp)) {
        logError('config.ftp must have username, password and base_path');
        console.log('curr value: ', ftp)
        process.exit(1);
    }
    const ssh = config.config.ssh;
    if (!('username' in ssh) || !('password' in ssh)) {
        logError('config.ssh must have username and password');
        console.log('curr value: ', ssh)
        process.exit(1);
    }

    for (let i = 0; i < config.steps.length; i++) {
        const sh = config.steps[i];
        if ('shell' in sh) {
            config.steps[i]['shell'].command = formatCommand(config, sh.shell);
            if (config.steps[i]['shell'].message) {
                config.steps[i]['shell'].message = sh.shell.message.replace('$command', sh.shell.command);
            }
        }
    }

    if (process.argv.includes('--print-config') || process.argv.includes('--trace')) {
        console.log(config);
        process.exit(0);
    }
    config.steps = validateSteps(config);

    config.config.source_basepath ??= './';
    config.config.ftp
    config.config.ssh = sshEnv;

    return config;
}

function validateSteps(yaml: DeployYaml) {
    if (!yaml.steps) {
        return yaml.steps = [];
    }
    yaml.steps.filter(t => 'predefined' in t)
        .map(t => (t as any).predefined as PredefinedMethods)
        .forEach((t: PredefinedMethods) => {
            let method: string;
            if (typeof t === 'object') {
                if (!('method' in t)) {
                    logError(`"${t}" is not a valid predefined function`);
                    process.exit(1);
                }
                method = t.method;
            } else
                method = t;
            if (method in obsoleteMethods) {
                logError(`Obsolete method "${method}": ${obsoleteMethods[method]}`);
                process.exit(1);
            }
            if (!(predefinedMethods as any).includes(method)) {
                logError(`"${t}" is not a valid predefined function`);
                process.exit(1);
            }
        });

    return yaml.steps;
}

async function checkFtpDeployFile() {
    if (fs.existsSync(ftpDeployYamlPath))
        return;

    const shouldCreateNew = await promptConfirm({
        message: 'No "ftp-deploy.yml" file found in the root directory. Do you want to create a new one? (default: Yes)',
    });
    if (!shouldCreateNew)
        process.exit(1);

    const os = await promptChoice({
        message: 'What is the type of your project?',
        choices: [
            {title: 'IIS (Windows)', value: ProjectTypes.iis},
            {title: 'Laravel (Linux)', value: ProjectTypes.laravel},
        ]
    }) as ProjectType;

    fs.writeFileSync(ftpDeployYamlPath, os === ProjectTypes.iis ? defaultConfigIIS : defaultConfigLaravel);

    const contentToAddToEnv = 'FTP_SERVER=\nFTP_USERNAME=\nFTP_PASSWORD=\nSSH_USERNAME=\nSSH_PASSWORD=\n';
    if (!fs.existsSync('.env')) {
        fs.writeFileSync('.env', contentToAddToEnv);
        logWarning('\n- Created default ".env" file in the root directory. Fill in all information.');
    } else {
        const content = fs.readFileSync('.env').toString();
        if (!content.includes('FTP_') && !content.includes('SSH_')) {
            fs.appendFileSync('.env', contentToAddToEnv);
            logWarning('\n- Added default "FTP_" and "SSH_" variables to the existing ".env" file. Fill in all information.');
        }
    }
    logWarning('- Created default "ftp-deploy.yml" file in the root directory. Have a look, edit if necessary and start again!');

    if (fs.existsSync('.gitignore')) {
        const content = fs.readFileSync('.gitignore').toString();
        if (!content.includes('.env') && await promptConfirm({
            message: 'Your .gitignore does NOT contain ".env". Do you want to add it? (Highly recommended) (default: Yes)',
        })) {
            fs.appendFileSync('.gitignore', '\n.env')
            logWarning('- Added ".env" to .gitignore');
        }
    } else {
        const shouldCreateNew = await promptConfirm({
            message: 'No ".gitignore" file found in the root directory. Do you want to create a default one? (default: Yes)',
        });
        if (shouldCreateNew) {
            fs.writeFileSync('.gitignore', '.env\nnode_modules');
            logWarning('- Created default ".gitignore" file in the root directory. Added ".env" to it');
        }
    }

    process.exit(1);
}

export function getFtpInfoFromEnv() {
    const ftp = parseEnv('FTP_', false, true);
    // if ('username' in ftp == false || 'password' in ftp == false || 'base_path' in ftp == false){
    //     console.log(ftp)
    //     logError('config.ftp must have these values: username, password and base_path');
    //     process.exit(1);
    // }
    return ftp as EnvCredentials;
}

export function getSshInfoFromEnv(ftpInfo: EnvCredentials): Credentials | null {
    const ssh = parseEnv('SSH_', false, true);
    // if ('username' in ssh == false || 'password' in ssh == false){
    //     logError('ssh.username or ssh.password is not set!');
    //     process.exit(1);
    // }

    if (!('server' in ssh))
        ssh['server'] = ftpInfo?.server;
    ssh['target_basepath'] = ftpInfo?.target_basepath;
    return ssh as EnvCredentials;
}

export function getValueOfStringArgFromYaml(config: DeployYaml, strKey: string) {
    strKey = strKey.trim();
    console.log('-' + strKey + '-', typeof strKey);
    if (typeof strKey !== 'string' || !strKey.startsWith('${') || !strKey.endsWith('}')) {
        console.log("if (typeof a !== 'string' || !a.startsWith(`\${`) || !a.endsWith(`}`)){")
        return strKey.toString();
    } else {
        let dottedKey = strKey.substring(2, strKey.length - 1);
        const [k, ...keys] = dottedKey.split('.');
        let val = config[k];
        for (const k of keys) {
            if (!val) {
                return undefined;
            }
            val = val[k];
        }
        if (val !== undefined)
            return val as string;

        return undefined;
    }
}

export function formatCommand(config: DeployYaml, shell: ShellProps) {
    if (!shell.args || shell.args.length == 0)
        return shell.command;
    const args: string[] = [];
    for (let a of shell.args) {
        const res = getValueOfStringArgFromYaml(config, a);
        if (res === undefined) {
            logError(`"${shell.command}" has "${a}" as argument but it doesn't exist in config!`);
            process.exit(1);
        }
        args.push(res);
    }
    return stringFormat(shell.command, args);
}