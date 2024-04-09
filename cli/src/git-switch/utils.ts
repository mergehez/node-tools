import {parseYaml, runShell} from "../cli_utils";
import {createInterface} from 'node:readline/promises';
import {logError} from "../../../shared/src/helpers";

const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});

export type Account = { name: string, email: string, token: string };

export async function updateGlobalGitConfig(key: string, value: string) {
    await runShell({
        command: `git config --global --unset ${key}`,
        ignore_error: true,
    });
    await runShell({
        command: `git config --global --add ${key} ${value}`,
    });
}

export async function gitConfigToGitInfo() {
    const gitConfigStr = await runShell({
        command: 'git config --global --list',
        ignore_stdout: true,
    });
    const config1 = parseYaml(gitConfigStr, 'user');
    const res = {};
    for (const key in config1) {
        if (!key.includes('.'))
            continue;
        const p = key.split('.');
        if (!(p[0] in res))
            res[p[0]] = {};
        res[p[0]][p[1]] = config1[key];
    }
    const config = res as Record<string, Account>;
    if (!checkAccount(config, 'user1') || !checkAccount(config, 'user2')) {
        logError('Your git config is either not initialized or missing some information');
        // console.log('Add following credentials to global git config. (you can add more users like user3, user4...)');
        await completeAccount(config, 'user1');
        await completeAccount(config, 'user2');
        process.exit();
    }

    if (!('user' in config)) { // check if there is already a connected git account
        config.user = config.user2; // so that it switches to the first account
    }

    return config;
}

export async function askAndSetConfig(text: string, key: string) {
    let res = '';
    while (!res.trim())
        res = await rl.question(text + "\n> ");
    if (res == 'q')
        process.exit();
    await updateGlobalGitConfig(key, res);
    return res;
}


function checkAccount(config: Record<string, Account>, key: string) {
    if (!(key in config))
        return false;
    const acc = config[key];
    return 'name' in acc && 'email' in acc && 'token' in acc;

}

async function completeAccount(config: Record<string, Account>, key: string) {
    if (!(key in config)) {
        config[key] = {} as Account;
    }

    if (!('name' in config[key])) {
        config[key].name = await askAndSetConfig('username of first account', `${key}.name`);
    }
    if (!('email' in config[key])) {
        config[key].email = await askAndSetConfig(`email of "${config[key].name}"`, `${key}.email`);
    }
    if (!('token' in config[key])) {
        config[key].token = await askAndSetConfig(`personal access token of "${config[key].name}" (with "repo" and "read:org" scopes)`, `${key}.token`);
    }
}