import { Engine } from 'php-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findInDir } from '../../../shared/src/helpers';
import { DefaultMinifyOptions, MinifyOptions } from './utils';

const files:string[] = [];
findInDir('storage/framework/views', (path, stat)=> {
    if(path.endsWith('.php'))
        files.push(path);
});

let options = DefaultMinifyOptions;
const current_dir = path.dirname(fileURLToPath(import.meta.url));
new Promise(async function () {
    console.log('');
    console.log(files.length ? '\x1b[34marg-phpmin result:\x1b[0m' : '\x1b[90marg-phpmin: no file to minify!\x1b[0m');
    for (const f of files) {
        options.output = f
        // const aaa = fs.readFileSync(current_dir + '/' + f, 'utf8');
        await minifyPHP(current_dir + '/' + f, options);
    }
    console.log('');
    return true;
});

function minifyPHP(file_value: string, user_options?: MinifyOptions) {
    user_options ??= DefaultMinifyOptions;

    const parser = new Engine({
        parser: { extractDoc: true },
        lexer: { all_tokens: true }
    });
    // Options
    var options_excludes:string[] = [];

    // var options_minify_replace_variables = true;
    var options_minify_remove_whitespace = true;
    var options_minify_remove_comments = true;

    var options_output = "";

    if (user_options.excludes && "indexOf" in user_options.excludes) options_excludes = user_options.excludes;
    if (user_options.minify) {
        // if(user_options.minify.propertyIsEnumerable("replace_variables")) options_minify_replace_variables = !!user_options.minify.replace_variables;
        if (user_options.minify.propertyIsEnumerable("remove_whitespace")) options_minify_remove_whitespace = user_options.minify.remove_whitespace;
        if (user_options.minify.propertyIsEnumerable("remove_comments")) options_minify_remove_comments = user_options.minify.remove_comments;
    }
    if (user_options.output) options_output = user_options.output;

    function uniqid(prefix?:string, suffix?:string) {
        return (prefix ?? '') + Date.now().toString(36) + (suffix ?? '');
    }

    // Minify & Obsfuscate Function
    function parseData(source_code: string) {
        let functions:string[] = [];
        let variables:string[] = [];
        let new_source = '';

        // Return an array of tokens (same as php function token_get_all)
        let tokens = parser.tokenGetAll(source_code);

        tokens.forEach((token, key) => {
            if (!Array.isArray(token)) {
                new_source += token;
                return;
            }

            if (token[0] === 'T_VARIABLE' && options_excludes.indexOf(token[1]) < 0) {
                if (!variables[token[1]]) variables[token[1]] = uniqid();
            }

            if(token[0] === 'T_STRING' && typeof tokens[key - 2] !== 'undefined' && Array.isArray(tokens[key - 2])){
                if(tokens[key - 2][1] === "$this" && !variables["$" + token[1]])
                    variables["$" + token[1]] = uniqid();
                else if (tokens[key - 2][1] === "function" && !functions[token[1]])
                    functions[token[1]] = token[1];
            }

            if (options_minify_remove_comments && (token[0] === 'T_COMMENT' || token[0] === 'T_DOC_COMMENT')) {
                return;
            }

            new_source += token[1];
        });

        // Minify and Obsfuscate
        tokens = parser.tokenGetAll(new_source);
        // console.log(tokens.filter(t => t[0] == 'T_INLINE_HTML' && t[1].includes('<script')))

        new_source = '';
        tokens.forEach((token, key) => {
            if (Array.isArray(token)) {
                if (token[0] === 'T_WHITESPACE' && options_minify_remove_whitespace) {
                    if (typeof tokens[key - 1] !== 'undefined' && typeof tokens[key + 1] !== 'undefined'
                        && Array.isArray(tokens[key - 1]) && Array.isArray(tokens[key + 1])
                        && tokens[key - 1][1].match(/[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*/)
                        && tokens[key - 1][1].match(/[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*/)
                    ) {
                        new_source += " ";
                    }
                }
                else if (token[0] === 'T_CASE') {
                    new_source += token[1] + " ";
                }
                else if (token[0] === 'T_OPEN_TAG') {
                    new_source += "<?php ";
                }
                else if (token[0] === 'T_CLOSE_TAG') {
                    new_source += " ?>";
                }
                else if (token[0] === 'T_INLINE_HTML') {
                    new_source += token[1].replace(/[\n\r]+/g, '').replace(/\s{2,10}/g, ' ');
                }
                else {
                    new_source += token[1];
                }
            } else {
                new_source += token;
            }
        }, this);

        //  Finished
        return new Promise(function (resolve: (val: string) => void, reject) {
            if (options_output) {
                fs.writeFile(options_output, new_source, function (err) {
                    if (err) reject('Error: Can’t Write to File');
                    const initialSize = Buffer.from(source_code).length;
                    const newSize = Buffer.from(new_source).length;
                    const sizeDiff = initialSize === newSize ? '\x1b[90malready minified' : `\x1b[32m${initialSize} => ${newSize} \x1b[90m(-${initialSize - newSize} bytes)`;
                    console.log(`  - \x1b[35m${path.parse(file_value).base}\x1b[0m: ${sizeDiff}\x1b[0m`.padStart(3));
                });
            }
            return resolve(new_source);
        });
    }

    function isFileSync(aPath) {
        var max_path_length = 4096;
        try {
            if (aPath.length > max_path_length || aPath.indexOf("<?php") !== -1) {
                return false;
            } else {
                return fs.statSync(aPath).isFile();
            }
        } catch (e) {
            if (e.code === "ENAMETOOLONG") {
                max_path_length = aPath.length; // so that we do not make the same mistake again
                return false;
            } else if (
                e.code === 'ENOENT' ||
                e.endsWith("TOOLONG") // for ENAMETOOLONG, WSAENAMETOOLONG, and any other future too-long error
            ) {
                return false;
            } else {
                throw e;
            }
        }
    }

    // Check if it's a file path
    if (isFileSync(file_value)) {
        // Reads the file
        return new Promise(function (resolve, reject) {
            fs.readFile(file_value, 'utf8', (err, file_data) => {
                if (err) reject('Error: Can’t Read From the Source File or Disk');

                // Check if it's a .php file
                if (path.extname(file_value) !== ".php")
                    reject('Error: This is Not a PHP File');

                parseData(file_data).then(resolve, reject);
                // parseData(file_data, file_value).then(resolve, reject);
            });
        });
    } else {
        return Promise.resolve(parseData(file_value));
    }
}
