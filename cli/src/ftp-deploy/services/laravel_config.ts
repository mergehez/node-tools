import {Executer, ExecuterConfig, ExecuterUtils} from "./base_executer";
import path from "path";
import {TPredefined} from "../yaml_types";
import {TFileToUpload, TFileFromServer} from "../types";


export const unix_consts = {
    eol: '\n',
    time: {
        tzDiffCommand: 'date +%H',
        parseHour: (str: string) => parseInt(str),
        areFilesWithSeconds: true,
    },
    sshUnzipCommand: 'unzip -o',
    sshDeleteCommand: 'rm',
}
export const createLaravelExecuter = (cfg: ExecuterConfig) : Executer => {
    return {
        ...unix_consts,
        runSpecificPredefined(predefined: TPredefined, utils: ExecuterUtils): Promise<void> {
            return Promise.resolve(undefined);
        },
        sshPrependCdToCommand: (cmd: string): string => {
            return `cd ${cfg.target_basepath} || { echo "'${cfg.target_basepath}' doesn't exist"; exit 1; }; ${cmd}`
        },
        sshGetFilesFromServer: async (serverUtcDiffInSec: number, utils: ExecuterUtils): Promise<TFileFromServer[]> => {
            let filesFromServer: TFileFromServer[] = [];
            let cmd = `find `;
            for (const ignore of cfg.ignoreArr) {
                if (ignore == '/.*' || ignore == '/*.*')
                    continue;
                let i = ignore.startsWith('/') ? '.' + ignore : ignore;
                if (i.endsWith('/'))
                    i = i.substring(0, i.length - 1);
                cmd += `-not \\( -path "${i}" -prune \\) `;
            }
            cmd += `-type f -printf '{"time":%As,"size":%s,"path":"%p"},'`; //'@As' => seconds since epoch
            const jsonStr = await utils.runShellSsh({
                command: cmd,
                message: 'blue|\n-> fetching file info from server...',
                ignore_stdout: true
            });
            const res = JSON.parse('[' + jsonStr.substring(0, jsonStr.length - 1) + ']');
            for(const r of res){
                filesFromServer.push({
                    path: r.path,
                    mtime: r.time - serverUtcDiffInSec,
                    ctime: r.time - serverUtcDiffInSec,
                    size: r.size
                });
            }
            return filesFromServer;
        }
    }
}

