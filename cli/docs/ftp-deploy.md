# ftp-deploy

```shell
npx ftp-deploy

npx ftp-deploy --config=path-to-my-yaml-file.yml
```

- `ncftpput` command must be available on your computer
  - windows: https://www.ncftp.com/download/
  - mac: `brew install ncftp`
  - linux: `sudo apt-get install ncftp`
  - other: google it

## Options

| option         | description                                                                             |
| -------------- | --------------------------------------------------------------------------------------- |
| --config       | path to ftp deploy yml file                                                             |
| --print-config | print the parsed yaml file. (useful for debugging)                                      |
| --fresh        | skip comparing local files with remote files. (=upload all files. this takes more time) |
| --act          | print the shell commands without executing them                                         |
| --dry-run      | run the script until predefined function "local:exit_if_dry_run" is called.             |
| --help         | print options                                                                      |

## ftp-deploy Config
```ts
{
    config: {
        project_type?: 'iis' | 'laravel',   // default is 'laravel'
        source_basepath: string,            
        target_basepath: string,            // (full) absolute path to the project root directory on the server
        iis_pool: testo                     // required, if project_type is 'iis'
        iis_site: testo                     // required, if project_type is 'iis'
        host: string,
        ftp: {
            username: string,
            password: string,
            base_path: string,
        },
        ssh: {
            username: string,
            password: string,
        },
        dist_dirs?: string[],               // for printing "files to upload". files inside these dirs, won't be printed, instead "- dir/*"
        ignores: string[],                  // using gitignore syntax

        [key: string]: any,                 // any other key-value pair. See the step examples 'local:sleep' and shell.args
    },
    steps: Step[],
}
```


### Step Examples
```yaml
  steps:
    - log: I am a log

    - predefined: server:find_new_files
    - predefined:
        method: local:sleep
        ms: 2000
    - predefined:
        method: server:restart_iis_site
        pool: ${config.iis_pool}

    - shell:                                                                   
        command: cd {{0}} && cd {{1}} && cd {{0}}               # {{0}} = args[0] (index of args)  
        args: 
          - ${config.myDirA}    # {{0}}
          - ${myVars.dirB}      # {{1}} you can actually access any value inside yaml file (only dot notation!)
    - shell:   # the same step but more compact                                                                
        command: cd {{0}} && cd {{1}} && cd {{0}}                   
        args: ['${config.myDirA}', '${myVars.dirB}']  # note that you have to wrap them using quotes!      
    - shell:
        command: npm run build || exit 2;
        message: blue|\n-> npm run build
        ignore_stdout: true                           # if true, no output to console. default is false (only for non-ssh)
        on_error: 'throw'                           # if 'throw', stops the program here. default is 'throw'. other options: 'print'(don't throw), 'ignore' (ignore totally)
    - shell:
        ssh: true
        command: composer install --optimize-autoloader --no-interaction --no-dev --prefer-dist
        message: blue|\n-> composer install non-dev dependencies
        on_error: 'ignore'
```

### Predefined method names: 
    - local:sleep
    - local:exit_if_dry_run
    - server:upload_files
    - server:find_new_files
    - server:restart_iis_site
    - server:unzip
    - server:delete_zip
    - local:dispose_ssh
    - local:finish
    
    
### Notes
  1. ssh shell commands are executed in the `target_basepath` directory. Of course, you can change the directory in your command using `cd` command
  2. `shell.message` is optional. if not defined, nothing gets printed!
  3. you can use `${command}` for shell message. this prints the executed command
```yaml
  - shell:
      command: rm -r "./bin";
      message: ${command}             # console output will be: rm -r "./bin";
```
  1. shell messages can be printed colored.
```yaml
    message: shell message with default color
    message: blue|my blue shell message

    # supported colors
    # - black
    # - red
    # - green
    # - yellow
    # - blue
    # - cyan
    # - magenta
    # - white
    # - gray # Alias for `blackBright`.
    # - grey # Alias for `blackBright`.
    # - blackBright
    # - redBright
    # - greenBright
    # - yellowBright
    # - blueBright
    # - cyanBright
    # - magentaBright
    # - whiteBright
```