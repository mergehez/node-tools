export type TFileToUpload = {
    // path without source directory. for printing purposes
    trimmedPath: string,
    // path starting from the source directory
    fullPath: string,
}
export type TFileFromServer = {
    path: string,
    mtime: number,
    ctime: number,
    size: number,
}

export const ProjectTypes = {
    iis: 'iis',
    laravel: 'laravel',
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