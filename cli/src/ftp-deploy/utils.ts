import {runShell, ShellProps} from "../cli_utils";
import {TFileToUpload} from "./types";
import {log, logError, logInfo, logSuccess, logWarning, normalizePath} from "../../../shared/src/helpers";
import AdmZip from "adm-zip";
import fs from "node:fs";
import fsPath from "node:path";
import {EOL} from "node:os";
import {consts, Executer, ExecuterConfig, ExecuterUtils} from "./services/base_executer";

export const createExecuterUtils = (baseCfg: ExecuterConfig, platformExecuter: Executer): ExecuterUtils => ({
    runShellSsh: (cfg, prependCd) => runShellSsh(cfg, prependCd, baseCfg, platformExecuter),
    compressFilesForUpload: (files, dirsToGroup) => compressFilesForUpload(files, dirsToGroup, baseCfg),
    uploadZipFile: () => uploadZipFile(baseCfg),
    getUtcDiff: (hourToCompare: number) => {
        const utcHour = parseInt(new Date().toISOString().split('T')[1].split(':')[0]);
        return (utcHour - hourToCompare) * 60 * 60;
    }
})

async function runShellSsh(cfg: ShellProps, prependCd = true, baseCfg: ExecuterConfig, platformExecuter: Executer): Promise<string> {
    if (!prependCd || cfg.command.startsWith('cd '))
        return await runShell(cfg, baseCfg.ssh);
    cfg.command = platformExecuter.sshPrependCdToCommand(cfg.command);
    return await runShell(cfg, baseCfg.ssh);
}

function compressFilesForUpload(files: TFileToUpload[], dirsToGroup: string[], baseCfg: ExecuterConfig) {
    const distDirsPrinted = (dirsToGroup ?? []).reduce((obj, val) => ({...obj, [normalizePath(val)]: false}), {});

    const zip = new AdmZip();
    log('\nFILES TO UPLOAD:');
    for (const f of files) {
        let printed = false;
        for (const distDir in distDirsPrinted) {
            if (!f.trimmedPath.startsWith(distDir))
                continue;

            if (!distDirsPrinted[distDir]) {
                logSuccess(`- ${distDir}/*`);
                distDirsPrinted[distDir] = true;
            }
            printed = true;
        }
        if (!printed) {
            logSuccess('- ' + f.trimmedPath);
        }

        zip.addFile(f.trimmedPath, fs.readFileSync(f.fullPath));
    }

    if (process.argv.includes('--dry-run'))
        return;

    // const buffer = await zip.toBuffer()
    const zipPath = fsPath.join(baseCfg.source_basepath, consts.zipFileName);
    logInfo(`\n-> Creating '${zipPath}'.`);
    fs.writeFileSync(zipPath, zip.toBuffer());
}

async function uploadZipFile(baseCfg: ExecuterConfig) {
    try {
        logInfo('\n-> Uploading files:');
        const remotePath = baseCfg.target_basepath.substring(baseCfg.ftpInfo.base_path.length).replace('//', '/');
        const sourcePath = fsPath.join(baseCfg.source_basepath, consts.zipFileName).replace('//', '/');
        await runShell({
            command: `ncftpput -R -v -u "${baseCfg.ftpInfo.username}" -p "${baseCfg.ftpInfo.password}" ${baseCfg.host} ${remotePath} ${sourcePath}`,
            on_error: 'ignore',
            ignore_stdout: false,
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
        fs.rmSync(fsPath.join(baseCfg.source_basepath, consts.zipFileName));
    } catch (error) {
        log(error)
        process.exit(1);
    }
};