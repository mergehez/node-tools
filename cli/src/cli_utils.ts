import chalk from "chalk";
import fs from 'node:fs';
import { execSync } from "child_process";

export function runShell(
    cmd: string, 
    message: string|null = null, 
    ignoreError = false,
    returnContent = false
){
    if(message)
        console.log(message);
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
            console.log(chalk.red("failed with status " + err.status))
        throw err;
        // process.exit(err.status);
    }
}


export function parseEnv(prefix:string, exitIfNoEnv = true){
    if(!fs.existsSync('./.env')){
        console.log(chalk.red('No .env file found!'));
        return exitIfNoEnv ? process.exit(1) : null;
    }

    return parseYaml(fs.readFileSync('./.env').toString(), prefix)
}

export function parseYaml(content: string, prefix: string){
    return content.split('\n')
                .filter(t => t.startsWith(prefix))
                .reduce((obj: any, t) => {
                    obj[t.split('=')[0]] = t.substring(t.indexOf('=')+1)
                    return obj;
                }, {});
}