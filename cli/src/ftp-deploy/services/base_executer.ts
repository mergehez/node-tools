import {findInDir, log, logError, logInfo, logSuccess, sleep, trimPath, unixTsToDate} from "../../../../shared/src/helpers";
import ignore, {Ignore} from "../ignore";
import {NodeSSH} from "node-ssh";
import {runShell, ShellProps} from "../../cli_utils";
import {TFileToUpload, TFileFromServer} from "../types";
import {createIISExecuter, windows_consts} from "./iis_config";
import {TFtpInfo, TPredefined, TPredefinedImplementations, TPredefinedX, TSshInfo, TYamlConfig} from "../yaml_types";
import {createLaravelExecuter, unix_consts} from "./laravel_config";
import {parseFtpDeployYaml} from "../yaml";
import {createExecuterUtils} from "../utils";

export const consts = {
    zipFileName: 'ftpdeploy_archive.zip',
}

export type Executer = {
    sshPrependCdToCommand: (cmd: string) => string,
    eol: string,
    time: { tzDiffCommand: string; parseHour: (str: string) => number; areFilesWithSeconds: boolean; },
    sshDeleteCommand: string,
    sshUnzipCommand: string,
    runSpecificPredefined: (predefined: TPredefined, utils: ExecuterUtils) => Promise<void>,
    sshGetFilesFromServer: (serverUtcDiffInSec: number, utils: ExecuterUtils) => Promise<TFileFromServer[]>
}

export type ExecuterConfig = {
    host: string;
    sshInfo: TSshInfo;
    ssh: NodeSSH;
    startTime: number;
    ftpInfo: TFtpInfo;
    ignoreArr: string[];
    ig: Ignore;
    source_basepath: string;
    target_basepath: string;
    isDryRun: boolean;
    isFresh: boolean
    isAct: boolean;
    isLogFiles: boolean;
}

export type ExecuterUtils = {
    compressFilesForUpload: (files: TFileToUpload[], dirsToGroup: string[]) => void;
    runShellSsh: (cfg: ShellProps, prependCd?: boolean) => Promise<string>;
    uploadZipFile: () => Promise<void>
    getUtcDiff: (hourToCompare: number) => number
}

export const createExecuter = async () => {
    const startTime = performance.now();
    const yamlConfig = await parseFtpDeployYaml();

    let ssh: NodeSSH;
    try {
        ssh = await new NodeSSH().connect({
            host: yamlConfig.config.host,
            username: yamlConfig.config.ssh.username,
            password: yamlConfig.config.ssh.password,
        });
    } catch (error) {
        if (error.message?.includes('All configured authentication methods failed')) {
            logError('Invalid SSH credentials given!')
            process.exit(1);
        }
        throw error;
    }

    const cfg: ExecuterConfig = {
        startTime: startTime,
        source_basepath: yamlConfig.config.source_basepath,
        target_basepath: yamlConfig.config.target_basepath,
        host: yamlConfig.config.host,
        ftpInfo: yamlConfig.config.ftp,
        sshInfo: yamlConfig.config.ssh,
        ssh: ssh,
        ignoreArr: yamlConfig.config.ignores,
        ig: ignore().add(yamlConfig.config.ignores),
        isAct: process.argv.includes('--act'),
        isDryRun: process.argv.includes('--dry-run'),
        isFresh: process.argv.includes('--fresh'),
        isLogFiles: process.argv.includes('--log-files'),
    }

    const executer: Executer = yamlConfig.config.project_type === 'iis' ? createIISExecuter(cfg) : createLaravelExecuter(cfg);

    const baseUtils = createExecuterUtils(cfg, executer);
    const predefinedImpls: TPredefinedImplementations = {
        "local:dispose_ssh":        () => localDisposeSSH(cfg),
        "local:exit_if_dry_run":    () => localExitIfDryRun(cfg),
        "local:finish":             () => localFinish(startTime),
        "server:delete_zip":        () => serverDeleteZip(baseUtils, executer),
        "server:find_new_files":    () => serverFindNewFiles(cfg, yamlConfig, baseUtils, executer),
        "server:unzip":             () => serverUnzip(baseUtils, executer),
        "server:upload_files":      () => serverUploadFiles(baseUtils),
        "local:sleep":              (method: TPredefinedX<'local:sleep'>) => localSleep(method),
        "server:restart_iis_site":  (method: TPredefinedX<'server:restart_iis_site'>) => serverRestartIISSite(method, baseUtils),
    };

    return {
        start: async () => {
            for (const step of yamlConfig.steps) {
                if ('predefined' in step) {
                    const method = step.predefined;
                    const name = typeof method === 'string' ? method : method.method;
                    if(typeof method === 'string'){
                        await predefinedImpls[name]();
                    }else{
                        await predefinedImpls[name](method);
                    }
                } else if ('shell' in step) {
                    step.shell.message ||= null;
                    if (step.shell.ssh) {
                        await baseUtils.runShellSsh(step.shell);
                    } else {
                        await runShell(step.shell);
                    }
                } else if ('log' in step) {
                    log(typeof step.log === 'string' ? step.log : step.log.message);
                } else {
                    logError(`"${step}" is not a valid step!`);
                    process.exit(1);
                }
            }
        }
    }
}


async function localDisposeSSH(cfg: ExecuterConfig): Promise<void> {
    cfg.ssh.dispose();
}
async function localExitIfDryRun(cfg: ExecuterConfig): Promise<void> {
    if (cfg.isDryRun) {
        logInfo('\n-> End of dry-run!');
        process.exit(0);
    }
}
async function localFinish(startTime: number): Promise<void> {
    const execTime = (performance.now() - startTime).toFixed(0);
    logSuccess(`\n🎉 FINISHED SUCCESSFULLY in ${execTime} ms 🎉`);
    process.exit(0);
}
async function localSleep(method: TPredefinedX<'local:sleep'>): Promise<void> {
    logInfo(`\n-> sleeping ${method.ms} ms`);
    await sleep(Number(method.ms));
}
async function serverDeleteZip(baseUtils: ExecuterUtils, executer: Executer): Promise<void> {
    logInfo(`\n-> Deleting ${consts.zipFileName} on the server using SSH...`);
    await baseUtils.runShellSsh({command: executer.sshDeleteCommand + ' ' + consts.zipFileName});
}
async function serverFindNewFiles(cfg: ExecuterConfig, yamlConfig: TYamlConfig, baseUtils: ExecuterUtils, executer: Executer): Promise<void> {
    let filesFromServer: TFileFromServer[] = [];
    const newFiles: TFileToUpload[] = [];
    // const localUtcDiffInSec = new Date(0).getTimezoneOffset() * 60

    const localConsts = (process.platform === 'win32' ? windows_consts : unix_consts);
    const tzResLocal = (await runShell({command: localConsts.time.tzDiffCommand, ignore_stdout: true})).split(localConsts.eol).filter(t => t.trim())[0].trim();
    const localUtcDiffInSec = baseUtils.getUtcDiff(localConsts.time.parseHour(tzResLocal));
    if (!cfg.isFresh) {
        const tzRes = (await baseUtils.runShellSsh({
            command: executer.time.tzDiffCommand,
            ignore_stdout: true
        })).split(executer.eol).filter(t => t.trim())[0].trim();
        const serverUtcDiffInSec = baseUtils.getUtcDiff(executer.time.parseHour(tzRes));
        logInfo('localUtcDiffInSec: ' + localUtcDiffInSec)
        logInfo('serverUtcDiffInSec: ' + serverUtcDiffInSec)
        // process.exit()
        filesFromServer = await executer.sshGetFilesFromServer(serverUtcDiffInSec, baseUtils);
    }
    findInDir<TFileToUpload>({
        baseDir: cfg.source_basepath,
        onFound: (obj) => {
            newFiles.push(obj);
        },
        ignore: cfg.ig,
        objectCreator: (data) => {
            const {path: fullPath, trimmedPath, stat} = data;

            if (cfg.isFresh) {
                return {
                    trimmedPath,
                    fullPath,
                };
            }

            const remote = filesFromServer.find(v => trimmedPath == trimPath(v.path, cfg.source_basepath));

            if (cfg.isLogFiles) {
                log("\n- " + trimmedPath, 'blue');
            }
            if (!remote) {
                if (cfg.isLogFiles) {
                    log("     not found on server", 'blue');
                }

                return {
                    trimmedPath,
                    fullPath,
                };
            }

            if (fullPath.includes('.dll')) {
                // console.log(stat);
                // console.log(remote);
                // process.exit(1)
            }

            let mTime = Math.round((stat.mtimeMs - localUtcDiffInSec * 1000) / 1000);
            if (!executer.time.areFilesWithSeconds) // we don't receive seconds from windows, so we set second of local time to 0
                mTime = Math.round(mTime / 60) * 60;

            if (cfg.isLogFiles) {
                let cTime = Math.round((stat.ctimeMs - localUtcDiffInSec * 1000) / 1000);
                if (!executer.time.areFilesWithSeconds) // we don't receive seconds from windows, so we set second of local time to 0
                    cTime = Math.round(cTime / 60) * 60;
                log("   server: " + remote.ctime + ' (' + unixTsToDate(remote.ctime) + ") - " + ', ' + remote.mtime + ' (' + unixTsToDate(remote.mtime) + ") - " + remote.size + ' bytes', 'blue');
                log("    local: " + cTime + ' (' + unixTsToDate(cTime) + ") - " + ', ' + mTime + ' (' + unixTsToDate(mTime) + ") - " + stat.size + ' bytes', 'blue');
                log("     diff: " + Math.round((mTime - remote.mtime)) + 's ' + Math.round((mTime - remote.mtime) / 60) + 'm ' + Math.round((mTime - remote.mtime) / 60 / 60) + 'h', 'blue');
            }
            if (remote.size === stat.size && mTime <= remote.mtime && (!remote.ctime || mTime <= remote.ctime+60)) // compare remote.mtime with local.ctime. because ctime on remote is actually mtime on local when last uploaded
                return null;

            return {
                trimmedPath,
                fullPath,
            };
        }
    })

    if (newFiles.length === 0) {
        logError('\n There is no new file!');
        process.exit();
    }

    baseUtils.compressFilesForUpload(newFiles, yamlConfig.config.dist_dirs);
}
async function serverRestartIISSite(method: TPredefinedX<'server:restart_iis_site'>, baseUtils: ExecuterUtils): Promise<void> {
    const p = method.pool;
    const s = method.site;
    logInfo(`\n-> restarting app pool (${p}) and site (${s})`);
    await baseUtils.runShellSsh({
        command: `cd C:/Windows/System32/inetsrv && appcmd recycle apppool /apppool.name:"${p}" && appcmd stop site /site.name:"${s}" && appcmd start site /site.name:"${s}"`,
    }, false);
}
async function serverUnzip(baseUtils: ExecuterUtils, executer: Executer): Promise<void> {
    logInfo('\n-> Unzipping on the server using SSH...');
    await baseUtils.runShellSsh({command: executer.sshUnzipCommand + ' ' + consts.zipFileName});
}
async function serverUploadFiles(baseUtils: ExecuterUtils): Promise<void> {
    await baseUtils.uploadZipFile();
}