#!/usr/bin/env node

import {runShell} from "../cli_utils";
import {askAndSetConfig, gitConfigToGitInfo, updateGlobalGitConfig} from "./utils";
import {rmSync, writeFileSync} from "node:fs";
import {logError, logSuccess} from "../../../shared/src/helpers";

const config = await gitConfigToGitInfo();
const {user: _, ...accounts} = config;

const keys = Object.keys(accounts);
let nextAccountKey = "user2";
for (let i = 0; i < keys.length; i++) {
    if (accounts[keys[i]].name == config.user.name)
        nextAccountKey = keys[(i + 1) % keys.length];
}

const lastUserName = config.user.name;
config.user = accounts[nextAccountKey];
await runShell({
    command: 'gh auth logout --hostname github.com',
    on_error: 'ignore',
    ignore_stdout: true,
})

const tempFileName = "./MergehezCli_GitTemp.txt";

async function tryLogin(retryCount = 3) {
    try {
        writeFileSync(tempFileName, config.user.token);
        await runShell({
            command: `gh auth login --hostname github.com --with-token < ${tempFileName}`,
            on_error: "throw",
            ignore_stdout: true,
        })

        await updateGlobalGitConfig("user.name", config.user.name);
        await updateGlobalGitConfig("user.email", config.user.email);
        return true;
    } catch (err) {
        const stderr = err?.stderr?.toString();
        if (retryCount <= 0) {
            logError("please start again and this time type the correct personal access token!",);
            process.exit(1);
        }

        if (stderr?.includes("missing required scope")) {
            config.user.token = await askAndSetConfig(
                `the personal access token of "${config.user.name}" doesn't have required scopes: "repo", "read:org". please generate a new one and type it here.`,
                `${nextAccountKey}.token`,
            );
            if (retryCount > 0) return tryLogin(--retryCount);
        } else if (stderr?.includes("Bad credentials")) {
            config.user.token = await askAndSetConfig(
                `the personal access token of "${config.user.name}" is either expired or wrong. please generate a new one (with scopes "repo" and "read:org") and type it here.`,
                `${nextAccountKey}.token`,
            );
            if (retryCount > 0) return tryLogin(--retryCount);
        } else {
            throw err;
        }
    }
}

if (await tryLogin()) {
    rmSync(tempFileName);
    logSuccess(`successfully switched from "${lastUserName}" to "${config.user.name}"`);
    process.exit(0);
}
process.exit(2);
