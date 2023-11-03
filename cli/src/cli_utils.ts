import chalk from "chalk";
import fs from 'node:fs';
import { execSync } from "child_process";
import { log, logError } from "../../shared/src/helpers";

export function runShell(
    cmd: string, 
    message: string|null = null, 
    ignoreError = false,
    returnContent = false
){
    if(message)
        log(message);

    if(process.argv.includes('--act')){
        log(`->ACT runShell: ${cmd}`, 'cyan')
        return;
    }
    try {
        const res = execSync(cmd, {stdio: returnContent ? 'pipe' :'inherit'});
        if(returnContent)
            return res?.toString().trim();
    }catch (err){ 
        if(ignoreError)
            return null;
        
        if(err.status === undefined && !returnContent){
            console.log(err);
        }
        if(!returnContent)
            logError("failed with status " + err.status)
        throw err;
        // process.exit(err.status);
    }
}


export function parseEnv(prefix:string, exitIfNoEnv = true, removePrefix = false){
    if(!fs.existsSync('./.env')){
        console.log(chalk.red('No .env file found!'));
        return exitIfNoEnv ? process.exit(1) : null;
    }
    return parseYaml(fs.readFileSync('./.env').toString(), prefix, removePrefix);
}

export function validateEnvRecord(obj: Record<Lowercase<string>, string>, prefix: string, keys: string[]){
    for(const key of keys){
        if(!(key in obj)){
            console.log(chalk.red(prefix + key.toUpperCase() + ' was not found in .env file!'));
            process.exit(1);
        }
    }
}

export function parseYaml(content: string, prefix: string, removePrefix = false) : Record<Lowercase<string>, string>{
    let lines = content.split('\n')
                    .filter(t => t.startsWith(prefix));

    if(removePrefix)
        lines = lines.map(t => t.substring(prefix.length))

    return lines.reduce((obj: any, t) => {
                obj[t.split('=')[0].toLocaleLowerCase()] = t.substring(t.indexOf('=')+1)
                return obj;
            }, {});
}