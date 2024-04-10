import fs from 'node:fs';
import fsPath from 'node:path';
import chalk, {ColorName as LogColor, foregroundColorNames as logColors} from 'chalk';

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

/**
 * replace {{0}}, {{1}}... with the corresponding index in the args array
 */
export function stringFormat(str: string, args: string[]) {
    return str.replace(/{{(\d+)}}/g, (_, index) => args[index] || `{${index}}`);
}

export function log(message: string, color?: LogColor) {
    try {
        message = message?.toString();
    } catch (error) {

    }
    message ??= '';
    message = message.replace('\\r\\n', '\r\n')
                    .replace('\\n', '\n');
    if (color)
        return console.log(chalk[color](message));

    if (!message.includes('|'))
        return console.log(message);

    const f = message.split('|');
    color = logColors.find(t => t == f[0]);
    return log(message.substring(f[0].length + 1), color);
}

export const logError = (message: any, exit?: boolean) => {
    log(message, 'red');
    if (exit)
        process.exit(1);
};
export const logSuccess = (message: any) => log(message, 'green');
export const logWarning = (message: any) => log(message, 'yellow');
export const logInfo = (message: any) => log(message, 'blue');

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}