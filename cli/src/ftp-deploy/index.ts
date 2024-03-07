#!/usr/bin/env node

import chalk from "chalk";
import AdmZip from "adm-zip";
import fs from 'node:fs'
import fsPath from 'node:path'
import ignore, { Ignore } from './ignore';
import { Credentials, Manifest, PredefinedMethods, ProjectTypes, Step, findInDir, formatCommand, ftpDeployYamlPath, parseGlobalConfig, runShellSsh } from "./utils";
import path from "node:path";
import { NodeSSH } from "node-ssh";
import { runShell } from "../cli_utils";
import { log, logError, logInfo, logSuccess, logWarning, sleep } from "../../../shared/src/helpers";

const zipFileName = 'archive.zip';
const { config, steps, deployer } = await parseGlobalConfig();
const ftpInfo = config.ftp;
const ig = ignore().add(config.ignores);
const sshInfo = config.ssh && config.ssh.username && config.ssh.password ? config.ssh : null;
const shouldZip = config.zip == 'always' || !!sshInfo;

var startTime = performance.now()
let lastFiles: Manifest | undefined;
let newFiles: Manifest = {};
let ssh: NodeSSH | undefined;

function prepareDeployer() {
  if (fs.existsSync(deployer.path_data)) {
    fs.rmSync(deployer.path_data, { recursive: true, force: true });
  }
  try {
    if (fs.existsSync(deployer.path_manifest))
      lastFiles = JSON.parse(fs.readFileSync(deployer.path_manifest).toString());
  } catch (error) {
    lastFiles = undefined;
    console.error(chalk.red("Couldn't parse manifest.json"));
  }
}
function findNewFiles(ig: Ignore) {
  newFiles = {};

  findInDir(config.source_basepath, (path, stat) => {
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
  if (!fs.existsSync(deployer.path_data))
    fs.mkdirSync(deployer.path_data, { recursive: true });

  const distDirsPrinted = (config.dist_dirs ?? []).reduce((obj, v) => ({ ...obj, [v]: false }), {});

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

    const dest = fsPath.join(deployer.path_data, src);

    let pathInZip = src;
    if(pathInZip.startsWith('./')) {
        pathInZip = pathInZip.substring(2);
    }
    if(pathInZip.startsWith(basePathTrimmed)) {
        pathInZip = pathInZip.substring(basePathTrimmed.length);
    }
    if(pathInZip.startsWith('/')) {
        pathInZip = pathInZip.substring(1);
    }
    if (shouldZip) {
      zip.addFile(pathInZip, fs.readFileSync(src));
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
    fs.writeFileSync(path.join(deployer.path_data, zipFileName), buffer);
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
  fs.writeFileSync(deployer.path_manifest + '.tmp', JSON.stringify(newFiles, null, 2));
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

async function serverDeleteDistDirs() {
  const cmd = config.dist_dirs.map(t => `rm -r ${config.target_basepath}/${t};`).join(' ');

  logInfo('\n-> Deleting dist dirs on server');
  await runShellSsh(ssh, cmd, true);
}

async function restartIISSite(method: PredefinedMethods) {
  if (!(typeof method === 'object') || !method.pool) {
    logError('pool is not defined for server:restart_iis_site!');
    logError(method);
    process.exit(1);
  }
  const pool = method.pool;
  const cmd = `cd C:/Windows/System32/inetsrv && appcmd recycle apppool /apppool.name:"${pool}" && appcmd stop site /site.name:"${pool}" && appcmd start site /site.name:"${pool}"`;

  logInfo(`\n-> restarting app pool and site (${method.pool})`);
  await runShellSsh(ssh, cmd, false);
}

async function uploadFilesViaFtp() {
  try {
    logInfo('\n-> Uploading files:');
    runShell(`ncftpput -R -v -u "${ftpInfo.username}" -p "${ftpInfo.password}" ${config.host} /${config.target_basepath} ${deployer.path_data}/*`);
    fs.writeFileSync(deployer.path_manifest, JSON.stringify(newFiles, null, 2));
    fs.rmSync(deployer.path_manifest + '.tmp');
  } catch (error) {
    log(error)
    process.exit(1);
  }
}
async function serverUnzipArchive(ssh: NodeSSH) {
  logInfo('\n-> Unzipping on the server using SSH...');
  const cmds = config.project_type !== ProjectTypes.iis ? [
    `cd ../www/wwwroot/${config.target_basepath} || { echo "'${config.target_basepath}' doesn't exist"; exit 1; };`,
    `unzip -o ${zipFileName};`
  ] : [
    `cd C:/inetpub/wwwroot/${config.target_basepath} && 7z x -aoa archive.zip`
  ];
  await runShellSsh(ssh, cmds.join(' '));
}
async function serverDeleteArchive(ssh: NodeSSH) {
  logInfo(`\n-> Deleting ${zipFileName} on the server using SSH...`);
  const cmds = config.project_type !== ProjectTypes.iis ? [
    `cd ../www/wwwroot/${config.target_basepath} || { echo "'${config.target_basepath}' doesn't exist"; exit 1; };`,
    `rm ${zipFileName};`
  ] : [
    `cd C:/inetpub/wwwroot/${config.target_basepath} && del archive.zip`
  ];
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
      log(chalk.yellow(`remove this line from your "${ftpDeployYamlPath}" file:`) + chalk.blue(`- predefined: ${method}`));
    if (command)
      logWarning(`remove the section with following command from your "${ftpDeployYamlPath}" file:\n`) + chalk.blue(command);
    process.exit(1);
  }
}

async function startAll() {
  if (process.argv.includes('--fresh')) {
    fs.rmSync(deployer.path_base, { recursive: true, force: true });
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
    const name = typeof method === 'string' ? method : method.method;
    // check variables and reset them
    if (typeof method === 'object') {
      Object.keys(method).forEach(k => {
        if (method[k].toString().startsWith('$config.')) {
          const key = method[k].toString().substring(8);
          if (key in config) {
            method[k] = config[key];
          } else {
            logError(`"${name}" has "${k}" as argument but it doesn't exist in config!`);
            process.exit(1);
          }
        }
      });
    }
    if (name === 'local:prepare_deployer') {
      prepareDeployer();
    } else if (name === 'local:find_new_files') {
      findNewFiles(ig);
    } else if (name === 'local:copy_files_to_deployer') {
      await copyFilesToDeployer();
    } else if (name === 'local:check_dry_run') {
      checkDryRun();
    } else if (name === 'local:save_deployer_status_tmp') {
      saveDeployerTmpStatus();
    } else if (name === 'server:delete_dist_dirs') {
      exitIfNoSshGiven(sshInfo, name);
      await serverDeleteDistDirs();
    } else if (name === 'local:sleep') {
      await sleepX(method);
    } else if (name === 'server:restart_iis_site') {
      exitIfNoSshGiven(sshInfo, name);
      await restartIISSite(method);
    } else if (name === 'local:upload_files') {
      await uploadFilesViaFtp();
    } else if (name === 'server:unzip') {
      exitIfNoSshGiven(sshInfo, name);
      await serverUnzipArchive(ssh);
    } else if (name === 'server:delete_zip') {
      exitIfNoSshGiven(sshInfo, name);
      await serverDeleteArchive(ssh);
    } else if (name === 'local:dispose_ssh') {
      if (ssh)
        disposeSsh(ssh);
    } else if (name === 'local:finish') {
      finish();
    } else {
      logError('method not found: ' + name);
    }
  }

  for (const step of steps) {
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
