import {TFileFromServer} from "../types";
import {logError, logInfo, logWarning} from "../../../../shared/src/helpers";
import {Executer, ExecuterConfig, ExecuterUtils} from "./base_executer";
import {TPredefined} from "../yaml_types";


// notes
// when dotnet build: ctime of files are set to now. (nuget caches the files, afterward they are no more updated)

export const windows_consts = {
    eol: '\r\n',
    time: {
        // tzDiffCommand: 'wmic timezone get Bias /value',
        tzDiffCommand: 'echo %time%',
        areFilesWithSeconds: false,
        parseHour: (str: string) => parseInt(str.split(':')[0])
    },
    sshUnzipCommand: '7z x -aoa',
    sshDeleteCommand: 'del',
}
export const createIISExecuter = (cfg: ExecuterConfig) : Executer => {
    return {
        ...windows_consts,
        sshPrependCdToCommand: (cmd: string): string => {
            return `cd ${cfg.target_basepath} && ${cmd}`
        },
        sshGetFilesFromServer: async (serverUtcDiffInSec: number, utils: ExecuterUtils): Promise<TFileFromServer[]> => {
            let filesFromServer: TFileFromServer[] = [], filesFromServer2: TFileFromServer[] = [];
            const lines = (await utils.runShellSsh({
                command: `dir /s /a:-D /t:w /-c`,// files with last modification time (mtime)
                message: 'blue|\n-> fetching file info from server...',
                ignore_stdout: true
            })).split('\r\n').map((t: string) => t.replace(/\\/g, '/').trim()).filter(t => t.length);

            const lines2 = (await utils.runShellSsh({
                command: `dir /s /a:-D /t:c /-c`,   // files with creation time (ctime)
                message: 'blue|\n-> fetching file info from server...',
                ignore_stdout: true
            })).split('\r\n').map((t: string) => t.replace(/\\/g, '/').trim()).filter(t => t.length);

            if(lines.length == 0 || lines2.length == 0){
                logWarning('No files found on the server!');
                return [];
            }
            const parseLine = (line: string, prop: 'ctime'|'mtime', prop2: 'ctime'|'mtime') => {
                // 5.03.2024  17:09              2571 default-ftp-deploy-laravel15.yml
                const x = line.matchAll(/(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})\s+(\d+)\s+(\S.*)/g).next().value.slice(1);
                const d = x[0].split('.').map(t => Number(t));
                const t = x[1].split(':').map(t => Number(t));
                const ms = new Date(d[2], d[1] - 1, d[0], t[0], t[1], 0).getTime() / 1000;
                // const utcDiff = utils.getUtcDiff(parseInt(t[0]));
                return{
                    path: (lastFolder + '/' + x[3]).replace(cfg.target_basepath + '/', cfg.source_basepath+'/').trim(),
                    [prop]: ms - serverUtcDiffInSec,
                    [prop2]: 0,
                    size: Number(x[2])
                } as TFileFromServer;
            }
            let lastFolder = '';
            for (const line of lines) {
                if (line.includes(cfg.target_basepath)) {
                    lastFolder = line.substring(line.indexOf(cfg.target_basepath)).trim();
                    continue;
                }
                if (line.match(/^\d{2}\.\d{2}/)) {
                    filesFromServer.push(parseLine(line, 'mtime', 'ctime'));
                }
            }
            lastFolder = '';
            for (const line of lines2) {
                if (line.includes(cfg.target_basepath)) {
                    lastFolder = line.substring(line.indexOf(cfg.target_basepath)).trim();
                    continue;
                }
                if (line.match(/^\d{2}\.\d{2}/)) {
                    filesFromServer2.push(parseLine(line, 'ctime', 'mtime'));
                }
            }

            if(filesFromServer.length != filesFromServer2.length){
                logError('Error: the number of files from server is different for mtime and ctime');
                process.exit(1);
            }

            for (let i = 0; i < filesFromServer.length; i++) {
                filesFromServer[i].ctime = filesFromServer2[i].ctime;
            }

            // console.log(filesFromServer)
            // process.exit(1)

            return filesFromServer;
        },



        runSpecificPredefined: async (predefined: TPredefined, utils: ExecuterUtils): Promise<void> => {
            if(typeof predefined === 'object' && 'method' in predefined){
              if(predefined.method == 'server:restart_iis_site'){
                  if (predefined.pool && predefined.site) {
                      const p = predefined.pool;
                      const s = predefined.site;
                      logInfo(`\n-> restarting app pool (${p}) and site (${s})`);
                      await utils.runShellSsh({
                          command: `cd C:/Windows/System32/inetsrv && appcmd recycle apppool /apppool.name:"${p}" && appcmd stop site /site.name:"${s}" && appcmd start site /site.name:"${s}"`,
                      }, false);
                      return;
                  }
                  if (!(typeof predefined === 'object')) {
                      logError('server:restart_iis_site must be an object containing "method", "pool" and "site" keys!');
                  } else if (!predefined.pool) {
                      logError('pool is not defined for server:restart_iis_site!');
                  } else if (!predefined.site) {
                      logError('site is not defined for server:restart_iis_site!');
                  }
                  console.log(predefined);
                  process.exit(1);
              }
            }else{

            }
        }
    }
}


