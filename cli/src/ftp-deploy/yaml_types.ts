import {ShellProps} from "../cli_utils";

export type TYamlRule =
    ({ type: 'string'|'boolean'|'number'|'array'}
        | { type: 'const', value: any }
        | { type: 'oneOfValues', options: readonly any[] }
        | { type: 'oneOfRules', rules: readonly TYamlRule[]  }
        | { type: 'object', props: Record<string, TYamlRule>, acceptsOtherProps?: boolean }) & { required?: boolean };
const msgDeployerObsolete = 'no more need to save last uploaded files locally! (just remove this step)';
export const obsoletePredefinedMethods: Record<string, string> = {
    'local:prepare_deployer': msgDeployerObsolete,
    'local:copy_files_to_deployer': msgDeployerObsolete,
    'local:save_deployer_status_tmp': msgDeployerObsolete,
    'local:find_new_files': 'please use "server:find_new_files" instead',
    'local:upload_files': 'please use "server:upload_files" instead',
} as const;
const predefinedParamlessMethods = [
    'local:exit_if_dry_run',
    'server:upload_files',
    'server:find_new_files',
    'server:unzip',
    'server:delete_zip',
    'local:dispose_ssh',
    'local:finish',
] as const;
export const predefinedMethodNames = [...predefinedParamlessMethods, 'local:sleep', 'server:restart_iis_site'] as const;
export const yamlConfigValidationRules = {
    config: {
        type: 'object',
        acceptsOtherProps: true,
        props: {
            // @ts-ignore
            project_type: {type: 'oneOfValues', options: ['iis', 'laravel'] as const },
            host: {type: 'string'},
            source_basepath: {type: 'string'},
            target_basepath: {type: 'string'},
            ftp: {
                type: 'object',
                props: {
                    username: {type: 'string'},
                    password: {type: 'string'},
                    base_path: {type: 'string'},
                }
            },
            ssh: {
                type: 'object',
                props: {
                    username: {type: 'string'},
                    password: {type: 'string'},
                }
            },
            dist_dirs: {type: 'array'},
            ignores: {type: 'array'},
        }
    } satisfies TYamlRule,
    step: {
        log: {
            type: 'oneOfRules',
            rules: [
                {type: 'string'},
                {type: 'object', props: {message: {type: 'string'}}}
            ] as const,
        } satisfies TYamlRule,
        shell: {
            type: 'object',
            props: {
                command: {
                    type: 'oneOfRules',
                    rules: [
                        {type: 'string'},
                        {
                            type: 'object',
                            props: {
                                windows: {type: 'string'},
                                other: {type: 'string'},
                            }
                        }
                    ] as const,
                },
                message: {type: 'string', required: false},
                ssh: {type: 'boolean', required: false},
                on_error: {type: 'oneOfValues', options: ['throw', 'print', 'ignore'] as const, required: false},
                ignore_stdout: {type: 'boolean', required: false},
                args: {type: 'array', required: false},
            }
        } satisfies TYamlRule,
        predefined: {
            type: 'oneOfRules',
            rules: [
                ...predefinedParamlessMethods.map(t => ({type: 'object', props: {method: {type: 'const', value: t}}} as const)),
                ...predefinedParamlessMethods.map(t => ({type: 'const', value: t} as const)),
                {
                    type: 'object',
                    props: {
                        method: {type: 'const', value: 'local:sleep'},
                        ms: {type: 'number'},
                    }
                },
                {
                    type: 'object',
                    props: {
                        method: {type: 'const', value: 'server:restart_iis_site'},
                        pool: {type: 'string'},
                        site: {type: 'string'},
                    }
                },
            ] as const
        } satisfies TYamlRule,
    },
} as const;


type ParseRule<R> =
    R extends { type: 'const', value: string }
        ? R['value']
        : R extends { type: infer KT, [K: string]: any }
        ? KT extends 'string' ? string
            : KT extends 'number' ? number
                : KT extends 'boolean' ? boolean
                    : KT extends 'array' ? any[]
                        : R extends TYamlRule ? ParseAdvancedRule<R>
                            : never
        : never;
type OptionalKeys<T> = {
    [K in keyof T]: T[K] extends { required: false } ? K : never;
}[keyof T];

type RequiredKeys<T> = {
    [K in keyof T]: T[K] extends { required: false } ? never : K;
}[keyof T];
type ParseAdvancedRule<R extends TYamlRule> =
    R extends { type: 'object', props: infer Props }
        ?  keyof Props extends RequiredKeys<Props>
            ? { [K in RequiredKeys<Props>]: ParseRule<Props[K]> }
            : keyof Props extends OptionalKeys<Props>
                ? { [K in OptionalKeys<Props>]?: ParseRule<Props[K]> }
                : { [K in RequiredKeys<Props>]: ParseRule<Props[K]> } & { [K in OptionalKeys<Props>]?: ParseRule<Props[K]> }
        : R extends { type: 'oneOfRules', rules: Readonly<Array<infer Props>>}
            ? Props extends TYamlRule ? ParseRule<Props> : never
            : R extends { type: 'oneOfValues', options: Readonly<Array<infer Props>>}
                ? Props
                : never;

type IsNotNever<T extends string|boolean|object> = [T] extends [never] ? never : T;
type TMessage = IsNotNever<ParseRule<typeof yamlConfigValidationRules.step.shell.props.message>>;
// type TXX = ParseRule<typeof yamlConfigValidationRules.step.shell.props.xx>;
type TCommand = IsNotNever<ParseAdvancedRule<typeof yamlConfigValidationRules.step.shell.props.command>>;
//    ^?
export type TYamlShell = IsNotNever<ParseAdvancedRule<typeof yamlConfigValidationRules.step.shell>>;
//    ^?
type TLog = IsNotNever<ParseAdvancedRule<typeof yamlConfigValidationRules.step.log>>;
export type TPredefined = IsNotNever<ParseAdvancedRule<typeof yamlConfigValidationRules.step.predefined>>;
export type TPredefinedName = typeof predefinedMethodNames[number];
type TPred<M, T> = T extends {method: infer Method} ? (Method extends M ? T : never) : never;
export type TPredefinedX<M extends TPredefinedName> = Exclude<TPredefined extends infer T ? TPred<M, T> : never, never>;
export type TConfig = IsNotNever<ParseAdvancedRule<typeof yamlConfigValidationRules.config>>;
export type TFtpInfo = IsNotNever<ParseAdvancedRule<typeof yamlConfigValidationRules.config.props.ftp>>;
export type TSshInfo = IsNotNever<ParseAdvancedRule<typeof yamlConfigValidationRules.config.props.ssh>>;
export type TProjType = IsNotNever<ParseAdvancedRule<typeof yamlConfigValidationRules.config.props.project_type>>;
export type TYamlConfigRaw = {
    config: TConfig,
    steps: ({ log: TLog }|{shell: TYamlShell}|{predefined: TPredefined})[],
}

export type TYamlConfig = {
    config: TConfig,
    steps: ({ log: TLog }|{shell: ShellProps}|{predefined: TPredefined})[],
}
export type TPredefinedImplementations = Record<TPredefinedName, (method?: TPredefinedX<TPredefinedName>) => Promise<void>>;
