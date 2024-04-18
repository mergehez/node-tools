import {_toString_Help, ProjectTypes,} from "./types";
import {parseEnv, promptChoice, promptConfirm, ShellProps} from "../cli_utils";
import {logError, logWarning, normalizePath, stringFormat} from "../../../shared/src/helpers";
import {EOL} from "node:os";
import fs from "node:fs";
import YAML from "yaml";
import defaultConfigIIS from "./default-ftp-deploy-iis.yml";
import defaultConfigLaravel from "./default-ftp-deploy-laravel.yml";
import {TYamlConfig, TYamlConfigRaw, TYamlShell, yamlConfigValidationRules, TYamlRule, predefinedMethodNames, obsoletePredefinedMethods, TProjType} from "./yaml_types";


export let ftpDeployYamlPath = "./ftp-deploy.yml";
export async function parseFtpDeployYaml(){
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

    // const str = fs.readFileSync(ftpDeployYamlPath, 'utf8');
    let configStr = fs.readFileSync(ftpDeployYamlPath, 'utf8')
        .split(EOL)
        .filter(t => t.trim().length > 0 && !t.trim().startsWith('#'))
        .join(EOL);

    // search for env variables in the yaml file
    const envKeys = configStr.match(/\${env\.[a-zA-Z0-9_.]+}/g);
    if (envKeys) {
        for (const key of envKeys) {
            const val = getValueOfStringArgFromYaml({config: {}, steps: []}, key);
            if (val === undefined) {
                logError(`"${key}" is not found in .env file!`);
                process.exit(1);
            }
            configStr = configStr.replace(key, val);
        }
    }

    const yamlRaw = YAML.parse(configStr) as TYamlConfigRaw;

    const printConfig = process.argv.includes('--print-config') || process.argv.includes('--trace');
    try {
        const yaml = validateYamlReplaceVarsConfig(yamlRaw);

        yaml.config.source_basepath = normalizePath(yaml.config.source_basepath);
        yaml.config.ignores = formatIgnores(yaml);

        if (printConfig) {
            console.log(JSON.stringify(yaml, null, 2));
            process.exit(0);
        }
        return yaml;
    }catch (e){
        if(printConfig){
            console.log(JSON.stringify(yamlRaw, null, 2));
        }
        throw e;
    }
}


function validateYamlReplaceVarsConfig(yaml: TYamlConfigRaw) : TYamlConfig {
    if(!yaml.config || !yaml.steps){
        logError('config or steps is not set in your yaml file!');
        process.exit(1);
    }

    type ConfigRes = true | ({level: number, exit?: boolean} & ({error: string} | {errors: {level: number, error: string}[]}));
    const configCheck = (obj: Record<string, any>, prop:string, rule: TYamlRule, keyPre:string, level = 0) : ConfigRes => {
        // console.log(`${level}. checking ${keyPre}${prop}`)
        switch(rule.type){
            case 'string': {
                return typeof obj[prop] !== 'string' ? {level, error: `${keyPre}${prop} must be a string!`} : true;
            }
            case 'array': {
                return !Array.isArray(obj[prop] ?? []) ? {level, error: `${keyPre}${prop} must be an array!`} : true;
            }
            case 'boolean': {
                return [0,1,true,false].some(t => t.toString() == obj[prop].toString()) ? true : {level, error: `${keyPre}${prop} must be an array!`}
            }
            case "number":
                return obj[prop]?.toString().match(/^\d+$/) ? true : {level, error: `${keyPre}${prop} must be a number!`};
            case "const":
                return obj[prop] === rule.value ? true : {level, error: `${keyPre}${prop} must be exactly ${rule.value}!`};
            case "oneOfValues":
                return rule.options.includes(obj[prop]) ? true : {level, error: `'${keyPre}${prop}' must be one of these: ${rule.options.join(', ')}, but it was: ${JSON.stringify(obj[prop])}!`};
            case "oneOfRules":
                const subRules = rule.rules;
                let errors: {level:number, error: string}[] | null = [];
                // console.log(rule.rules)
                for(const subRule of subRules){
                    if(subRule.type == 'object' && !obj[prop]){
                        continue;
                    }
                    let res = configCheck(obj, prop, {
                        ...subRule,
                        required: false,
                    }, keyPre, level+1);
                    if(res === true){
                        errors = null;
                        break;
                    }else{
                        if('error' in res){
                            const err = res.error;
                            const lvl = res.level;
                            if(!errors.some(t => t.level == lvl && t.error == err))
                                errors.push(res)
                        }else{
                            errors = errors.concat(res.errors);
                        }

                        if(res.level > level+1){
                            if(errors.length > 1)
                                errors = [errors[errors.length-1]]
                            break;
                        }
                    }
                }
                if(errors === null)
                    return true;
                if(errors.length === 0)
                    return {level, error: `'${keyPre}${prop}' failed validation: ${JSON.stringify(obj[prop])}!`};

                if(level == 0){
                    return {level, error: errors.map(t => t.error).join(EOL)};
                }
                return {level, errors};

            case "object":
                if(typeof obj[prop] !== 'object'){
                    return {level, error: `${keyPre}${prop} must be an object!`};
                }
                if(!rule.acceptsOtherProps){
                    for(const key in obj[prop]){
                        if(!(key in rule.props)){
                            return {level, error: `Unknown key: ${keyPre}${prop}.${key}!`, exit: true};
                        }
                    }
                }
                for(const key in rule.props){
                    if(!(key in obj[prop])){
                        if(rule.props[key].required === false)
                            continue;
                        return {level, error: `${keyPre}${prop}.${key} is not set!`};
                    }
                    const res = configCheck(obj[prop], key, rule.props[key], `${keyPre}${prop}.`, level+1)
                    if(res !== true){
                        return res;
                    }
                }
                return true;
            default: {
                logError('Unknown type: '+(rule as any).type);
            }
        }
    }
    const res = configCheck(yaml, 'config', yamlConfigValidationRules.config, '');
    if(res !== true){
        console.log(yaml.config)
        console.log(res);
        process.exit(1);
    }

    const stepRule = yamlConfigValidationRules.step;
    const rule = {
        type: 'oneOfRules',
        rules: Object.keys(stepRule).map(k => {
            return {
                type: 'object',
                props: {
                    [k]: {
                        ...stepRule[k],
                    },
                },
                // required: false,
            } satisfies TYamlRule;
        })
    } satisfies TYamlRule;
    for(const step of yaml.steps){
        const r = configCheck({step: step}, 'step', rule, '');
        if(r !== true){
            if('predefined' in step){
                let methodName = typeof step.predefined === 'object' ? step.predefined.method : step.predefined;
                if (methodName in obsoletePredefinedMethods) {
                    logError(`Obsolete method "${methodName}": ${obsoletePredefinedMethods[methodName]}`);
                    process.exit(1);
                }
                if (!(predefinedMethodNames as any).includes(methodName)) {
                    logError(`"${methodName}" is not a valid predefined function`);
                    process.exit(1);
                }
            }

            if('error' in r && (r.error.startsWith('step must be one of these rules: ') || r.error.startsWith("'step' failed validation:"))){
                console.log('only these step types are available: '+ Object.keys(stepRule).map(t=>`'${t}'`).join(', ')+'. '+EOL+'Failed step: ');
            }else{
                const strStep = JSON.stringify(step);
                console.log(('error' in r ? r.error : r.errors.join(EOL)).replace(strStep+'!', ''));
            }
            console.log(step)
            process.exit(1);
        }
    }

    for(const step of yaml.steps){
        if('shell' in step){
            step.shell = formatShellStep(yaml as any, step.shell);
            if('args' in step.shell)
                step.shell.args = undefined;
        }else if('predefined' in step && typeof step.predefined === 'object'){
            for (const k in step.predefined) {
                if (k === 'method')
                    continue;
                const res = getValueOfStringArgFromYaml(yaml, step.predefined[k]);
                if (res === undefined) {
                    logError(`"${step.predefined.method}.${k}" has "${step.predefined[k]}" as argument but it doesn't exist in yaml!`);
                    process.exit(1);
                }
                step.predefined[k] = res;
            }
        }
    }
    return yaml as TYamlConfig
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
    }) as TProjType;

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


let env: Record<string, any>;
export function getValueOfStringArgFromYaml(config: TYamlConfig|Record<string, any>, strKey: string) {
    if(typeof strKey !== 'string')
        return strKey;
    strKey = strKey?.trim();
    if (typeof strKey !== 'string' || !strKey.startsWith('${') || !strKey.endsWith('}')) {
        console.log('returning key -'+ strKey+"-")
        return strKey;
    } else {
        let dottedKey = strKey.substring(2, strKey.length - 1);
        let obj: Record<string, any>;
        if(dottedKey.startsWith('env.')){
            obj = env ??= parseEnv();
            dottedKey = dottedKey.substring(4);
        }else
            obj = config;

        const [k, ...keys] = dottedKey.split('.');
        let val = obj[k];
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

function formatShellStep(config: TYamlConfig, shell: TYamlShell) : ShellProps {
    let cmd = shell.command as string|{windows: string, other: string};
    if(typeof cmd === 'object') {
        if(shell.ssh){
            cmd = config.config.project_type === 'iis' ? cmd.windows : cmd.other;
        }else{
            cmd = process.platform === 'win32' ? cmd.windows : cmd.other;
        }
    }

    if ('args' in shell && Array.isArray(shell.args) && shell.args.filter(t => t).length){
        const args: string[] = [];
        for (let a of shell.args.filter(t=>t)) {
            const res = getValueOfStringArgFromYaml(config, a);
            if (res === undefined) {
                logError(`"${cmd}" has "${a}" as argument but it doesn't exist in config!`);
                process.exit(1);
            }
            args.push(res);
        }
        cmd = stringFormat(cmd as string, args);
    }
    return {
        command: cmd,
        on_error: shell.on_error,
        ignore_stdout: shell.ignore_stdout,
        message: shell.message?.includes('${command}') ? shell.message.replace(/\${command}/g, cmd) : shell.message,
        ssh: shell.ssh
    };
}

export function formatIgnores(yaml: TYamlConfig) {
    const ignores = yaml.config.ignores;
    if (!ignores)
        return ignores;

    return ignores.map(t => {
        if(t.includes('\*'))
            t = t.replace('\\*', '*');
        return t;
    });

}

