import fs from 'node:fs';
import path from 'node:path';
import { HmrContext } from 'vite';
import { _InternalMdiIcon } from './mdi-icons';

export type MdiIcon = _InternalMdiIcon | `${_InternalMdiIcon}:${'outlined' | 'sharp' | 'two-tone'}`;

export type ArgVitePluginConfig = {
    watch?: {
        directory: string,
        extensions: string[],
    },
    mdiIcons: MdiIcon[],
    target: string,
}

class _ConfigHelper {
    regexSearch: RegExp;
    content: string;
    icsAlreadyAdded: { name: string, url: string }[];
    config: ArgVitePluginConfig;
    relativePathFromTargetToRoot: string;
    regexCheck: RegExp | undefined;

    constructor(config: ArgVitePluginConfig) {
        this.regexSearch = new RegExp("\\.ic\\.ic-([A-z0-9-]+):before{ --ic-url: url\\((.*)\\)", "gim");
        this.content = "";
        this.icsAlreadyAdded = [];
        this.config = config;
        this.relativePathFromTargetToRoot = path.parse(config.target).dir.split("/").map((_) => "..").join("/") + "/";
        this.regexCheck = config.watch ? new RegExp(`${config.watch.directory}/(.*)\\.(${config.watch.extensions.join("|")})$`) : void 0;
    }
    get target() {
        return this.config.target;
    }
    findMatches(str: string, matches: { name: string, url: string, index: number }[] = []) {
        const res = this.regexSearch.exec(str);
        res && matches.push({ name: res[1], url: res[2], index: res.index }) && this.findMatches(str, matches);
        return matches;
    }
    getMdiUrl(name: string, type = "sharp") {
        return `${this.relativePathFromTargetToRoot}node_modules/@material-design-icons/svg/${type}/${name}.svg`;
    }
    getCssLine(name: string, url: string) {
        return `.ic.ic-${name}:before{ --ic-url: url(${url}); }`;
    }
    addNewIc(name: string, url: string, writeToFile = true) {
        if (name.includes(" ")) {
            throw `icon name cannot contain space: '${name}'`;
        }
        if (!fs.existsSync(url.replace(this.relativePathFromTargetToRoot, ""))) {
            throw `file doesn't exist: '${url.replace(this.relativePathFromTargetToRoot, "")}'`;
        }
        this.content += this.getCssLine(name, url);
        this.icsAlreadyAdded.push({ name, url });
        if (writeToFile)
            this.writeToFile();
    }
    writeToFile() {
        fs.writeFileSync(this.target, this.content.split("}.ic.").join("}\n.ic.").trim());
    }
    icExists(name: string) {
        return this.icsAlreadyAdded.some((t) => t.name === name);
    }
    findInDir(dir: string, exts = "json", fileList: string[] = [], regExp?: RegExp, replace = "") {
        dir = dir.replace(/\\/gi, "/");
        replace = replace.replace(/\\/gi, "/");
        const files = fs.readdirSync(dir);
        files.forEach((file) => {
            const filePath = path.join(dir, file).replace(/\\/gi, "/");
            if (fs.lstatSync(filePath).isDirectory()) {
                this.findInDir(filePath, exts, fileList, regExp, replace);
                return;
            }
            if (exts.split(",").map((t) => t.trim()).filter((ext) => file.endsWith(`.${ext}`)).length === 0) {
                return;
            }
            let res = replace.length === 0 ? filePath : filePath.replace(replace, "");
            if (res.length > 0 && (res[0] === "/" || res[0] === "\\")) {
                res = res.substring(1);
            }
            if (regExp) {
                if (regExp.test(res)) {
                    fileList.push(res);
                }
                return;
            }
            fileList.push(res);
        });
        return fileList;
    }
    addIcsFromDir() {
        if (!this.config.watch) {
            return false;
        }
        const files = this.findInDir(this.config.watch.directory, this.config.watch.extensions.join(","));
        let hasNew = false;
        for (const name of files) {
            if (this.onFileUpdateInDir(name, false))
                hasNew = true;
        }
        return hasNew;
    }
    onFileUpdateInDir(file: string, writeToFile = true) {
        if (!this.regexCheck?.test(file)) {
            return false;
        }
        const name = path.parse(file).name;
        if (this.icExists(name))
            return false;
        this.addNewIc(name, this.relativePathFromTargetToRoot + file, writeToFile);
        return true;
    }
    init() {
        console.log(`init: ${this.config.target}`);
        fs.readFile(this.config.target, (err, _) => {
            if (err)
                return console.error("arg-vite error: " + err.message);
            this.content = "";
            let hasNew = false;
            for (let mdi of this.config.mdiIcons) {
                let type;
                [mdi as any, type] = mdi.split(":");
                if (this.icExists(mdi))
                    continue;
                hasNew = true;
                this.addNewIc(mdi, this.getMdiUrl(mdi, type || "round"));
            }
            if (this.addIcsFromDir())
                hasNew = true;
            if (hasNew) {
                console.log("writing to file!");
                this.writeToFile();
            } else {
                console.log("no new icon!");
            }
        });
    }
}

/**
* https://marella.me/material-design-icons/demo/svg/
*/
export function vitePlugin(configs: ArgVitePluginConfig[]) {
    const helpers: _ConfigHelper[] = [];
    for (let i = 0; i < configs.length; i++) {
        helpers.push(new _ConfigHelper(configs[i]));
    }
    return {
        name: "vite:arg-ic-css",
        handleHotUpdate: (ctx: HmrContext) => {
            for (const helper of helpers) {
                if (!helper.config.watch)
                    continue;
                helper.onFileUpdateInDir(helper.config.watch.directory + "/" + path.parse(ctx.file).base);
            }
        },
        buildStart: () => {
            for (const helper of helpers) {
                helper.init();
            }
        }
    };
}


export default vitePlugin;