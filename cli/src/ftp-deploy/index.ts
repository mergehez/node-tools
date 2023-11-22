#!/usr/bin/env node

import chalk from "chalk";
import AdmZip from "adm-zip";
import fs from 'node:fs'
import fsPath from 'node:path'
import ignore, { Ignore } from 'ignore';
import { Credentials, Manifest, PredefinedMethods, Step, deployerPathBase, deployerPathData, deployerPathManifest, findInDir, formatCommand, parseGlobalConfig, runShellSsh } from "./utils";
import path from "node:path";
import { NodeSSH } from "node-ssh";
import { runShell } from "../cli_utils";
import { log, logError, logInfo, logSuccess, logWarning } from "../../../shared/src/helpers";

const zipFileName = 'archive.zip';
const { config, steps } = parseGlobalConfig();
const ftpInfo = config.ftp;
const ig = ignore().add(config.ignores);
const sshInfo = config.ssh && config.ssh.username && config.ssh.password ? config.ssh : null;
const shouldZip = config.zip == 'always' || !!sshInfo;

var startTime = performance.now()
let lastFiles: Manifest | undefined;
let newFiles: Manifest = {};
let ssh: NodeSSH | undefined;

function prepareDeployer() {
    if (fs.existsSync(deployerPathData)) {
        fs.rmSync(deployerPathData, { recursive: true, force: true });
    }
    try {
        if (fs.existsSync(deployerPathManifest))
            lastFiles = JSON.parse(fs.readFileSync(deployerPathManifest).toString());
    } catch (error) {
        lastFiles = undefined;
        console.error(chalk.red("Couldn't parse manifest.json"));
    }
}
function findNewFiles(ig: Ignore) {
    newFiles = {};

    findInDir('./', (path, stat) => {
        newFiles[path] = {
            size: stat.size,
            time: stat.mtimeMs,
            isSymLink: stat.isSymbolicLink(),
        };
    }, (path: string, _: string, stat) => {
        if (stat.isSymbolicLink())
            return true;

        if (ig.ignores(path))
            return true;

        return false;
    });
}

async function copyFilesToDeployer() {
    if (!fs.existsSync(deployerPathData))
        fs.mkdirSync(deployerPathData, { recursive: true });

    const distDirsPrinted = (config.dist_dirs ?? []).reduce((obj, v) => ({ ...obj, [v]: false }), {});

    const zip = new AdmZip();
    log('FILES TO UPLOAD:');
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

        const dest = fsPath.join(deployerPathData, src);
        if (shouldZip) {
            zip.addFile(src, fs.readFileSync(src));
        } else {
            if (!fs.existsSync(dest))
                fs.mkdirSync(fsPath.parse(dest).dir, { recursive: true });
            fs.copyFileSync(src, dest);
        }
    }
    if (Object.keys(newFiles).length === 0) {
        logError('\n There is no new file!');
        process.exit();
    }
    if (shouldZip) {
        const buffer = await zip.toBuffer()
        fs.writeFileSync(path.join(deployerPathData, zipFileName), buffer);
        logInfo(`\n-> Created '${zipFileName}'.`);
    }
}

function checkDryRun() {
    if (process.argv.includes('--dry-run')) {
        logInfo('\n-> End of dry-run!');
        process.exit(0);
    }
}

function saveDeployerTmpStatus() {
    fs.writeFileSync(deployerPathManifest + '.tmp', JSON.stringify(newFiles, null, 2));
}

async function serverDeleteDistDirs() {
    const cmd = config.dist_dirs.map(t => `rm -r ${config.target_basepath}/${t};`).join(' ');

    logInfo('\n-> Deleting dist dirs on server');
    await runShellSsh(ssh, cmd, true);
}

async function uploadFilesViaFtp() {
    try {
        logInfo('\n-> Uploading files:');
        runShell(`ncftpput -R -v -u "${ftpInfo.username}" -p "${ftpInfo.password}" ${config.host} /${config.target_basepath} ${deployerPathData}/*`);
        fs.writeFileSync(deployerPathManifest, JSON.stringify(newFiles, null, 2));
        fs.rmSync(deployerPathManifest + '.tmp');
    } catch (error) {
        log(error)
        process.exit(1);
    }
}
async function serverUnzipArchive(ssh: NodeSSH) {
    logInfo('\n-> Unzipping on the server using SSH...');
    const cmds = [
        `cd ../www/wwwroot/${config.target_basepath} || { echo "'${config.target_basepath}' doesn't exist"; exit 1; };`,
        `unzip -o ${zipFileName};`
    ]
    await runShellSsh(ssh, cmds.join(' '));
}
async function serverDeleteArchive(ssh: NodeSSH) {
    logInfo(`\n-> Deleting ${zipFileName} on the server using SSH...`);
    const cmds = [
        `cd ../www/wwwroot/${config.target_basepath} || { echo "'${config.target_basepath}' doesn't exist"; exit 1; };`,
        `rm ${zipFileName};`
    ]
    await runShellSsh(ssh, cmds.join(' '), true);
}

function disposeSsh(ssh: NodeSSH) {
    ssh.dispose();
}

function finish() {
    const execTime = (performance.now() - startTime).toFixed(0);
    logSuccess(`\n🎉 FINISHED SUCCESSFULLY in ${execTime} ms 🎉`);
    process.exit(0);
}

function exitIfNoSshGiven(sshInfo: Credentials, method?: PredefinedMethods, command?: string) {
    if (!sshInfo) {
        logError('even though you have NOT defined config.ssh information, you try to execute an ssh command!');
        if (method)
            log(chalk.yellow('remove this line from your ftp-deploy.yml file:') + chalk.blue(`- predefined: ${method}`));
        if (command)
            logWarning('remove the section with following command from your ftp-deploy.yml file:\n') + chalk.blue(command);
        process.exit(1);
    }
}

async function startAll() {
    if (process.argv.includes('--fresh')) {
        fs.rmSync(deployerPathBase, { recursive: true, force: true });
    }
    if (sshInfo) {
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
    }

    async function executePredefined(method: PredefinedMethods) {
        if (method === 'local:prepare_deployer') {
            prepareDeployer();
        } else if (method === 'local:find_new_files') {
            findNewFiles(ig);
        } else if (method === 'local:copy_files_to_deployer') {
            await copyFilesToDeployer();
        } else if (method === 'local:check_dry_run') {
            checkDryRun();
        } else if (method === 'local:save_deployer_status_tmp') {
            saveDeployerTmpStatus();
        } else if (method === 'server:delete_dist_dirs') {
            exitIfNoSshGiven(sshInfo, method);
            await serverDeleteDistDirs();
        } else if (method === 'local:upload_files') {
            await uploadFilesViaFtp();
        } else if (method === 'server:unzip') {
            exitIfNoSshGiven(sshInfo, method);
            await serverUnzipArchive(ssh);
        } else if (method === 'server:delete_zip') {
            exitIfNoSshGiven(sshInfo, method);
            await serverDeleteArchive(ssh);
        } else if (method === 'local:dispose_ssh') {
            if (ssh)
                disposeSsh(ssh);
        } else if (method === 'local:finish') {
            finish();
        } else {
            logError('method not found: ' + method);
        }
    }

    const allSteps = [...steps.local, ...steps.server] as Step[];
    for (const step of allSteps) {
        if ('predefined' in step) {
            await executePredefined(step.predefined);
        } else if ('ssh_shell' in step) {
            exitIfNoSshGiven(sshInfo, null, step.ssh_shell.command);
            let cmd = formatCommand(config, step.ssh_shell);
            await runShellSsh(ssh, cmd, step.ssh_shell.ignore_error);
        } else if ('shell' in step) {
            const cmd = formatCommand(config, step.shell);
            const msg = step.shell.message || null;
            runShell(cmd, msg, step.shell.ignore_error, step.shell.ignore_stdout);
        } else if ('log' in step) {
            log(step.log);
        } else {
            logError(`"${step}" is not a valid step!`);
        }
    }
}

startAll();