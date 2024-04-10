import chalk from "chalk";
import fs from 'node:fs';
import {execSync} from "child_process";
import {log, logError, logInfo, logWarning} from "../../shared/src/helpers";
import prompts from "prompts";
import {NodeSSH} from "node-ssh";
import {EOL} from "node:os";

export type ShellProps = {
    ssh?: boolean,
    command: string,
    args?: any[],
    message?: string,
    ignore_error?: boolean, // if true, it will not throw an error if the command fails.
    ignore_stdout?: boolean,
    return_error?: boolean,
    onError?: (err: any) => void,
}


// if ignore_stdout is false, it will return the output of the command. (only for local shell)
export async function runShell(props: ShellProps, ssh?: NodeSSH): Promise<string> {
    const {command: cmd, message, ignore_error, ignore_stdout} = props;
    if (message)
        log(message);

    if (process.argv.includes('--act')) {
        log(`->ACT shell: ${cmd}`, 'cyan')
        return null;
    }

    const onCatch = (err: any) => {
        const errStr = err?.stderr?.toString().replace('bash: line 0: ', '').trim();
        if (props.onError)
            props.onError(errStr ?? err);

        if (ignore_error)
            return null;


        if (err.status && !ignore_stdout) {
            logError("runShell failed with status " + err.status)
        }

        if (ssh) {
            ssh.dispose();
        }


        if (!message)
            logInfo(`shell command failed: ${cmd}`);

        if (errStr) {
            logError(errStr);
            process.exit(1);
        }

        logWarning(`THROWING ERROR!`);
        throw err; // TODO: prevent this from happening. try to print the error message
    }

    try {
        if (ssh) {
            const res = await ssh.exec(cmd, [], {
                onStderr: c => {
                    onCatch({
                        stderr: c.toString()
                    });
                    return null;
                }
            })
            return res?.toString().trim();
        } else {
            const res = execSync(cmd, {stdio: ignore_stdout ? 'pipe' : 'inherit'});
            if (ignore_stdout)
                return res?.toString().trim();
        }
    } catch (err) {
        return onCatch(err);
    }
}

export function parseEnv(prefix: string, exitIfNoEnv = true, removePrefix = false) {
    if (!fs.existsSync('./.env')) {
        console.log(chalk.red('No .env file found!'));
        return exitIfNoEnv ? process.exit(1) : null;
    }
    return parseYaml(fs.readFileSync('./.env').toString(), prefix, removePrefix);
}

export function parseYaml(content: string, prefix: string, removePrefix = false): Record<Lowercase<string>, string> {
    let lines = content.split(EOL)
        .filter(t => t.startsWith(prefix));

    if (removePrefix)
        lines = lines.map(t => t.substring(prefix.length))

    return lines.reduce((obj: any, t) => {
        obj[t.split('=')[0].toLocaleLowerCase()] = t.substring(t.indexOf('=') + 1)
        return obj;
    }, {});
}

export async function promptConfirm(cfg: { message: string, initial?: boolean }) {
    return (await prompts({
        type: 'confirm',
        name: 'value',
        message: cfg.message,
        initial: cfg.initial ?? true,
    })).value;
}

export async function promptChoice(cfg: { message: string, choices: prompts.Choice[] }) {
    return (await prompts({
        type: 'select',
        name: 'value',
        message: cfg.message,
        choices: cfg.choices
    })).value;
}