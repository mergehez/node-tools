import fs from 'node:fs';
import chalk, {ColorName as LogColor, foregroundColorNames as logColors} from 'chalk';
import {Ignore} from "ignore";
import fsPath from "node:path";
import CallSite = NodeJS.CallSite;

export const normalizePath = (path: string) => {
    path = path.trim().replace(/\\/gi, "/");
    if(!path || path == '.' || path == './*' || path == '*')
        path = '/';
    if(path.endsWith('*'))
        path = path.substring(0, path.length - 1);
    if(path.endsWith('/') && path.length > 1)
        path = path.substring(0, path.length - 1);
    if(path.startsWith('./') && path.length > 2)
        path = path.substring(2);
    return path;
};

export const trimPath = (path: string, basepath: string) => {
    const p = fsPath.join('.', path.replace(/\\/gi, "/"));
    const b = fsPath.join('.', basepath.replace(/\\/gi, "/"));
    return p.startsWith(b) ? p.substring(b.length + 1) : p
}


/**
 * Find files in a directory and its subdirectories
 * @param opts
 * @param opts.baseDir The base directory to start searching
 * @param opts.objectCreator This is called for each file found. It should return the object to be passed to onFound callback or null/false to exclude the file
 * @param opts.onFound The callback to call when a file is found. To exclude a file, return false/null from objectCreator function
 */
export function findInDir<T extends Record<string, any> = {
    path: string,
    trimmedPath: string,
    name: string,
    stat: fs.Stats
}>(opts: {
    baseDir: string,
    onFound: (data: T) => void,
    objectCreator?: (data: {
        path: string,
        trimmedPath: string,
        name: string,
        stat: fs.Stats
    }) => T | null,
    ignore?: Ignore,
    allowSymlinks?: boolean,
    firstBaseDir?: string, // used internally
}){
    opts.baseDir = normalizePath(opts.baseDir);
    if(opts.baseDir == '/')
        opts.baseDir = '.';
    else if(opts.baseDir.startsWith('/'))
        opts.baseDir = opts.baseDir.substring(1);
    opts.firstBaseDir ??= opts.baseDir;
    opts.objectCreator ??= t => t as unknown as T;
    // const dir = fsPath.join('.', opts.baseDir);
    let files: string[];
    try {
        files = fs.readdirSync(opts.baseDir);
    }catch (e){
        logError(e);
        process.exit(1);
    }
    for (const file of files) {
        let path = fsPath.join(opts.baseDir, file).replace(/\\/gi, "/");
        if(path[0] === "/" || path[0] === "\\")
            path = path.substring(1);

        const trimmedPath = path.includes('/') ?  trimPath(path, opts.firstBaseDir) : path;

        if (opts.ignore?.ignores(trimmedPath)){
            if(process.argv.includes('--log-files'))
                log("- " + path + " (was ignored by your config)", 'red');
            continue;
        }

        const stat = fs.lstatSync(path);
        if (!opts.allowSymlinks && stat.isSymbolicLink())
            continue;

        // the directory was not excluded. so let's look inside it
        if (stat.isDirectory()) {
            findInDir({
                baseDir: path,
                onFound: opts.onFound,
                objectCreator: opts.objectCreator,
                ignore: opts.ignore,
                firstBaseDir: opts.firstBaseDir,
                allowSymlinks: opts.allowSymlinks,
            });
        }else{
            const res = opts.objectCreator({
                path,
                trimmedPath,
                name: file,
                stat,
            });
            if(!res){
                continue;
            }
            opts.onFound(res);
        }
    }
}

/**
 * replace {{0}}, {{1}}... with the corresponding index in the args array
 */
export function stringFormat(str: string, args: string[]) {
    return str.replace(/{{(\d+)}}/g, (_, index) => args[index] || `{${index}}`);
}

export function trimStr(str: string, toTrim: string[], where: 'start' | 'end' | 'both' = 'both') {
    if(where !== 'end'){
        for (let i = 0; i < toTrim.length; i++){
            const t = toTrim[i];
            if (t && str.startsWith(t)) {
                str = str.substring(t.length);
                i = -1;
            }
        }
    }
    if(where !== 'start'){
        for (let i = 0; i < toTrim.length; i++){
            const t = toTrim[i];
            if (t && str.endsWith(t)) {
                str = str.substring(0, str.length - t.length);
                i = -1;
            }
        }
    }
    return str;
}
// const path = require('path');

['debug', 'warn', 'error'].forEach((methodName) => {
    const originalLoggingMethod = console[methodName];
    console[methodName] = (firstArgument: any, ...otherArguments: any[]) => {
        const originalPrepareStackTrace = Error.prepareStackTrace;
        Error.prepareStackTrace = (_, stack) => stack;
        const trace = new Error().stack as unknown as CallSite[];
        let origin = trace[0];
        let selectedIndex = 0;
        let funcHistory = '';
        for(let i = 0; i < trace.length; i++){
            const t = trace[i];
            if(!t.getFileName().startsWith('file://'))
                continue;
            let func = t.getFunctionName();
            if(!func || func == 'onCatch' || t.getFunctionName().startsWith('log'))
                continue;
            if(func.includes('<computed>') && t.getMethodName()){
                func = func.replace('<computed>', t.getMethodName());
            }
            // originalLoggingMethod(t.getFileName()+':'+t.getLineNumber() + ':' + func + ':' + t.getMethodName());
            if(!selectedIndex){
                origin = t;
                selectedIndex = i;
                funcHistory = func;
                continue;
            }
            if(funcHistory){
                funcHistory = func + ' -> ' + funcHistory;
            }
        }
        // if(selectedIndex )
        // originalLoggingMethod((new Error().stack as unknown as CallSite[]).map(t => t.getFileName()+':'+t.getLineNumber() + ':' + t.getMethodName() + ':' + t.getFunctionName() + ':' + t.getEvalOrigin() ));
        const callee = new Error().stack[1] as unknown as CallSite;
        Error.prepareStackTrace = originalPrepareStackTrace;
        const relativeFileName = fsPath.relative(process.cwd(), origin.getFileName());
        let prefix = `${relativeFileName}:${origin.getLineNumber()}`;
        if(prefix.includes('/dist/'))
            prefix = prefix.split('/dist/')[1];
        prefix = chalk.gray(`(${prefix}: ${funcHistory || origin.getFunctionName()})`);
        if (typeof firstArgument === 'string') {
            originalLoggingMethod(firstArgument, ...[...otherArguments, prefix]);
        } else {
            originalLoggingMethod(firstArgument, ...[...otherArguments, prefix]);
        }
    };
});
export function log(message: any, color?: LogColor, logMethod: 'log' | 'warn' | 'error' | 'debug' = 'log') {
    try {
        if(typeof message === 'object'){
            // console.log('type: ' + typeof message);
            if(Buffer.isBuffer(message)){
                message = message.toString()
            }else{
                message = JSON.stringify(message, null, 2)
                if(message.length == 2)
                    return;
            }
        }
        message =  message?.toString();
    } catch (error) {

    }
    message ??= '';
    message = message.replace('\\r\\n', '\r\n')
                    .replace('\\n', '\n');
    if (color)
        return console[logMethod](chalk[color](message));

    if (!message.includes('|'))
        return console[logMethod](message);

    const f = message.split('|');
    color = logColors.find(t => t == f[0]);
    return log(message.substring(f[0].length + 1), color);
}

export const logError = (message: any, exit?: boolean) => {
    log(message, 'red', 'error');
    if (exit)
        process.exit(1);
};
export const logSuccess = (message: any) => log(message, 'green', );
export const logWarning = (message: any) => log(message, 'yellow', 'warn');
export const logInfo = (message: any) => log(message, 'blue');

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function unixTsToDate(timestamp: number) {
    const s = new Date(timestamp * 1000).toISOString();
    return s.substring(0, s.indexOf('.')).replace('T', ' ');
}