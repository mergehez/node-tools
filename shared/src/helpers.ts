import fs from 'node:fs';
import fsPath from 'node:path';

export function findInDir(dir: string, onFound: (p:string, s:fs.Stats) => void, exclude?: (path:string, name:string, stat:fs.Stats) => boolean) {
    dir = dir.replace(/\\/gi, "/");
    const files = fs.readdirSync(dir);
    for (const file of files) {
        let path = fsPath.join(dir, file).replace(/\\/gi, "/");
        const stat = fs.lstatSync(path);
        if(exclude && exclude(path, file, stat)){
            continue;
        }
        if (stat.isDirectory()) {
            findInDir(path, onFound, exclude);
            continue;
        }
        if (path.length > 0 && (path[0] === "/" || path[0] === "\\")) {
            path = path.substring(1);
        }
        onFound(path, stat);
    }
}
