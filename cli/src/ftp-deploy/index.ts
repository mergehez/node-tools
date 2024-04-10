#!/usr/bin/env node

import AdmZip from "adm-zip";
import fs from 'node:fs'
import fsPath from 'node:path'
import ignore from './ignore';
import {formatCommand, getValueOfStringArgFromYaml, parseGlobalConfig} from "./utils";
import {Manifest, PredefinedMethods, ProjectTypes, PredefinedMethodName} from "./types";
import path from "node:path";
import {NodeSSH} from "node-ssh";
import {ShellProps, runShell} from "../cli_utils";
import {findInDir, log, logError, logInfo, logSuccess, logWarning, sleep} from "../../../shared/src/helpers";
import {EOL} from "node:os";

const zipFileName = 'ftpdeploy_archive.zip';
const yamlConfig = await parseGlobalConfig();
const {config, steps} = yamlConfig;
const ftpInfo = config.ftp;
const ig = ignore().add(config.ignores);
const sshInfo = config.ssh && config.ssh.username && config.ssh.password ? config.ssh : null;
const isIIS = config.project_type === ProjectTypes.iis;
const isFresh = process.argv.includes('--fresh');

// console.log(ig);
// process.exit(1);

const startTime = performance.now();
let lastFiles: Manifest | undefined;
let newFiles: Manifest = {};
let ssh: NodeSSH;

async function runShellSsh(cfg: ShellProps, prependCd = true) {
    if (!prependCd || cfg.command.startsWith('cd '))
        return await runShell(cfg, ssh);

    if (isIIS)
        cfg.command = `cd ${config.target_basepath} && ${cfg.command}`;
    else
        cfg.command = `cd ${config.target_basepath} || { echo "'${config.target_basepath}' doesn't exist"; exit 1; }; ${cfg.command}`;

    return await runShell(cfg, ssh);
}

async function findNewFilesViaSsh() {
    newFiles = {};
    let filesFromServer: any = undefined;
    if (!isFresh) {
        if (isIIS) {
            const lines = (await runShellSsh({
                command: `dir /s /a:-D /t:w /-c`,
                message: 'blue|\n-> fetching file info from server...',
                ignore_stdout: true
            })).split('\r\n').map((t: string) => t.replace(/\\/g, '/')).filter(t => t.trim().length > 0);

            filesFromServer = [];
            let lastFolder = '';
            const baseP = config.target_basepath;
            for (const line of lines) {
                if (line.includes(config.target_basepath)) {
                    lastFolder = line.substring(line.indexOf(baseP)).trim().replace(/\\/g, '/');
                    continue;
                }
                if (line.match(/^\d{2}\.\d{2}/)) {
                    // 5.03.2024  17:09              2571 default-ftp-deploy-laravel15.yml
                    const x = line.matchAll(/(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})\s+(\d+)\s+(\S.*)/g).next().value.slice(1);
                    const timeStr = `${x[0]} ${x[1]}`;
                    const timeEpoch = new Date(timeStr).getTime();
                    filesFromServer.push({
                        path: (lastFolder + '/' + x[3]).replace(config.target_basepath + '/', config.source_basepath).trim(),
                        time: Math.round(timeEpoch / 1000),
                        size: Number(x[2])
                    });
                }
            }
        } else {
            let cmd = `find `;
            for (const ignore of config.ignores) {
                if (ignore == '/.*' || ignore == '/*.*')
                    continue;
                let i = ignore.startsWith('/') ? '.' + ignore : ignore;
                if (i.endsWith('/'))
                    i = i.substring(0, i.length - 1);
                cmd += `-not \\( -path "${i}" -prune \\) `;
            }
            cmd += `-type f -printf '{"time":%As,"size":%s,"path":"%p"},'`; //'@As' => seconds since epoch
            const jsonStr = await runShellSsh({
                command: cmd,
                message: 'blue|\n-> fetching file info from server...',
                ignore_stdout: true
            });
            filesFromServer = JSON.parse('[' + jsonStr.substring(0, jsonStr.length - 1) + ']');
        }
    }

    findInDir(config.source_basepath, (path, stat) => {
        newFiles[path] = {
            size: stat.size,
            time: stat.mtimeMs,
            isSymLink: stat.isSymbolicLink(),
        };
    }, (path: string, _: string, stat) => {
        if (stat.isSymbolicLink())
            return true; // ignore

        if (ig.ignores(path))
            return true; // ignore

        if (isFresh)
            return false;

        const remote = filesFromServer.find((v: any) => {
            if (v.path.startsWith('./'))
                v.path = v.path.substring(2);
            return v.path === path;
        });
        if (!remote) {
            return false;
        }

        const localTimeEpoch = Math.round((stat.mtimeMs - new Date().getTimezoneOffset() * 60 * 1000) / 1000);
        // console.log(localTimeEpoch, remote.time, localTimeEpoch - remote.time, path);
        return remote.size === stat.size && localTimeEpoch <= remote.time;

    });

    if (Object.keys(newFiles).length === 0) {
        logError('\n There is no new file!');
        process.exit();
    }
    await zipFilesToUpload();
    // process.exit(1);
}

async function zipFilesToUpload() {
    const distDirsPrinted = (config.dist_dirs ?? []).reduce((obj, v) => ({...obj, [v]: false}), {});

    const zip = new AdmZip();
    log('\nFILES TO UPLOAD:');
    const basePathTrimmed = config.source_basepath.replace('./', '');
    for (const src in newFiles) {
        if (lastFiles && src in lastFiles) {
            const newFile = newFiles[src];
            const last = lastFiles[src];
            if (last.size == newFile.size && last.time == newFile.time)
                continue;
        }

        let printed = false;
        for (const distDir in distDirsPrinted) {
            if (!src.startsWith(distDir))
                continue;

            if (!distDirsPrinted[distDir]) {
                logSuccess(`- ${distDir}/*`);
                distDirsPrinted[distDir] = true;
            }
            printed = true;
        }
        if (!printed) {
            logSuccess('- ' + src);
        }

        let pathInZip = src;
        if (pathInZip.startsWith('./')) {
            pathInZip = pathInZip.substring(2);
        }
        if (pathInZip.startsWith(basePathTrimmed)) {
            pathInZip = pathInZip.substring(basePathTrimmed.length);
        }
        if (pathInZip.startsWith('/')) {
            pathInZip = pathInZip.substring(1);
        }
        zip.addFile(pathInZip, fs.readFileSync(src));
    }
    // const buffer = await zip.toBuffer()
    const zipPath = fsPath.join(config.source_basepath, zipFileName);
    fs.writeFileSync(zipPath, zip.toBuffer());
    logInfo(`\n-> Created '${zipPath}'.`);
}

async function checkDryRun() {
    if (process.argv.includes('--dry-run')) {
        logInfo('\n-> End of dry-run!');
        process.exit(0);
    }
}

async function sleepX(method: PredefinedMethods) {
    if (!(typeof method === 'object') || !method.ms) {
        logError('ms is not defined for local:sleep!');
        logError(method);
        process.exit(1);
    }

    logInfo(`\n-> sleeping ${method.ms} ms`);
    await sleep(Number(method.ms));
}

// async function serverDeleteDistDirs() {
//     logInfo('\n-> Deleting dist dirs on server');
//     await runShellSsh({
//         command: config.dist_dirs.map(t => `rm -r ${path.join(config.target_basepath, t)};`).join(' '),
//         ignore_error: true,
//     }, false);
// }

async function restartIISSite(method: PredefinedMethods) {
    if (typeof method === 'object' && method.pool && method.site) {
        const p = method.pool;
        const s = method.site;
        logInfo(`\n-> restarting app pool (${p}) and site (${s})`);
        await runShellSsh({
            command: `cd C:/Windows/System32/inetsrv && appcmd recycle apppool /apppool.name:"${p}" && appcmd stop site /site.name:"${s}" && appcmd start site /site.name:"${s}"`,
        }, false);
        return;
    }
    if (!(typeof method === 'object')) {
        logError('server:restart_iis_site must be an object containing "method", "pool" and "site" keys!');
    } else if (!method.pool) {
        logError('pool is not defined for server:restart_iis_site!');
    } else if (!method.site) {
        logError('site is not defined for server:restart_iis_site!');
    }
    console.log(method);
    process.exit(1);
}

async function uploadFilesViaFtp() {
    try {
        logInfo('\n-> Uploading files:');
        const remotePath = config.target_basepath.substring(config.ftp.base_path.length).replace('//', '/');
        const sourcePath = path.join(config.source_basepath, zipFileName).replace('//', '/');
        await runShell({
            command: `ncftpput -R -v -u "${ftpInfo.username}" -p "${ftpInfo.password}" ${config.host} ${remotePath} ${sourcePath}`,
            ignore_error: true,
            ignore_stdout: true,
            onError: (err) => {
                logWarning(err);
                if (!(typeof err === 'string')) {
                    logError(err);
                    process.exit(1);
                }
                const firstLine = err.split(EOL)[0];
                const possibleErrorMessages = [
                    'command not found',
                    'not recognized as an internal or external command',
                    'wurde nicht als Name eines Cmdlet',
                    'ist entweder falsch geschrieben oder',
                ]
                if (possibleErrorMessages.some(t => firstLine.includes(t))) {
                    if (process.platform.startsWith('win')) {
                        logError('ncftpput is not installed on your system! Please install it from https://www.ncftp.com/download/');
                    } else if (process.platform.startsWith('linux')) {
                        logError('ncftpput is not installed on your system! Please install it using "sudo apt-get install ncftp"');
                    } else if (process.platform.startsWith('darwin')) {
                        logError('ncftpput is not installed on your system! Please install it using "brew install ncftp" or any other package manager you use!');
                    } else {
                        logError('ncftpput is not installed on your system! Please install it.');
                    }
                } else {
                    logError('ftp upload failed!');
                    console.log(err);
                }
                process.exit(1);
            }
        });
        logInfo('\n-> Uploaded successfully! Now deleting the local zip file...');
        fs.rmSync(path.join(config.source_basepath, zipFileName));
    } catch (error) {
        log(error)
        process.exit(1);
    }
}

async function serverUnzipArchive() {
    logInfo('\n-> Unzipping on the server using SSH...');
    await runShellSsh({command: isIIS ? `7z x -aoa ${zipFileName}` : `unzip -o ${zipFileName};`});
}

async function serverDeleteArchive() {
    logInfo(`\n-> Deleting ${zipFileName} on the server using SSH...`);
    await runShellSsh({command: !isIIS ? `rm ${zipFileName}` : `del ${zipFileName};`});
}

async function finish() {
    const execTime = (performance.now() - startTime).toFixed(0);
    logSuccess(`\n🎉 FINISHED SUCCESSFULLY in ${execTime} ms 🎉`);
    process.exit(0);
}

async function startAll() {
    if (!sshInfo) {
        logError('You have to define config.ssh with correct information!');
        process.exit(1);
    }
    try {
        ssh = await new NodeSSH().connect({
            host: config.host,
            username: sshInfo.username,
            password: sshInfo.password,
        });
    } catch (error) {
        if (error.message?.includes('All configured authentication methods failed')) {
            logError('Invalid SSH credentials given!')
            process.exit(1);
        }
        throw error;
    }

    const predefinedFuncs: Record<PredefinedMethodName, (...args: any[]) => Promise<void>> = {
        // "local:prepare_deployer": undefined,
        // "local:copy_files_to_deployer": undefined,
        // "local:save_deployer_status_tmp": undefined,
        "local:exit_if_dry_run": checkDryRun,
        "server:upload_files": uploadFilesViaFtp,
        "local:sleep": sleepX,
        "server:find_new_files": findNewFilesViaSsh,
        // "server:delete_dist_dirs": serverDeleteDistDirs,
        "server:restart_iis_site": restartIISSite,
        "server:unzip": serverUnzipArchive,
        "server:delete_zip": serverDeleteArchive,
        "local:dispose_ssh": async () => ssh.dispose(),
        "local:finish": finish,
    };

    for (const step of steps) {
        if ('predefined' in step) {
            const method = step.predefined;
            const name = typeof method === 'string' ? method : method.method;
            if (typeof method === 'object') {
                for (const k in method) {
                    if (k === 'method')
                        continue;
                    method[k] = getValueOfStringArgFromYaml(yamlConfig, k, method[k]);
                    if (method[k] === undefined) {
                        logError(`"${name}.${k}" has "method[k]" as argument but it doesn't exist in yaml!`);
                        process.exit(1);
                    }
                }
            }
            if (name in predefinedFuncs) {
                await predefinedFuncs[name](method);
                continue;
            }
            logError('method not found: ' + name);
            process.exit(1);
        } else if ('shell' in step) {
            step.shell.command = formatCommand(yamlConfig, step.shell);
            step.shell.message ||= null;
            if (step.shell.ssh) {
                await runShellSsh(step.shell);
            } else {
                await runShell(step.shell);
            }
        } else if ('log' in step) {
            log(step.log);
        } else {
            logError(`"${step}" is not a valid step!`);
            process.exit(1);
        }
    }
}

await startAll();
