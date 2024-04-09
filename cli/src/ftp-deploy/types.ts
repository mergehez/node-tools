import {ShellProps} from "../cli_utils";

export const predefinedMethods = <const>[
    'local:exit_if_dry_run',
    'server:upload_files',
    'local:sleep',
    'server:find_new_files',
    'server:restart_iis_site',
    'server:unzip',
    'server:delete_zip',
    'local:dispose_ssh',
    'local:finish'
];

const msgDeployerObsolete = 'no more need to save last uploaded files locally! (just remove this step)';
export const obsoleteMethods: Record<string, string> = {
    'local:prepare_deployer': msgDeployerObsolete,
    'local:copy_files_to_deployer': msgDeployerObsolete,
    'local:save_deployer_status_tmp': msgDeployerObsolete,
    'local:find_new_files': 'please use "server:find_new_files" instead',
    'local:upload_files': 'please use "server:upload_files" instead',
} as const;

export type PredefinedMethodName = typeof predefinedMethods[number];
export type PredefinedMethods = PredefinedMethodName | {
    method: PredefinedMethodName,
    [key: string]: string,
};

export type Manifest = Record<string, {
    time: number,
    size: number,
    isSymLink?: boolean,
}>
export type Credentials = {
    username: string,
    password: string,
}

export type EnvCredentials = Credentials & {
    server: string,
    target_basepath: string,
}

export type Step = { predefined: PredefinedMethods }
    | { shell: ShellProps }
    | { log: string }

export const ProjectTypes = {
    iis: 'iis',
    laravel: 'laravel',
}
export type ProjectType = keyof typeof ProjectTypes;

export type Config = {
    host: string,
    source_basepath: string,
    target_basepath: string,
    ftp: Credentials & { base_path: string },
    ssh: Credentials,
    dist_dirs?: string[],
    ignores: string[],
    project_type?: ProjectType,
    [key: string]: any,
} & Record<string, string>;

export type DeployYaml = {
    config: Config,
    steps: Step[],
}

export const _toString_Help = `
options:
    --config            : path to ftp deploy yml file
    --print-config      : print the parsed yaml file. (useful for debugging)
    --fresh             : skip comparing local files with remote files. (=upload all files. this takes more time)
    --act               : print the shell commands without executing them
    --dry-run           : run the script until predefined function "local:exit_if_dry_run" is called. You can change its position in your ftp deploy yml file
    --help              : print this message
`;