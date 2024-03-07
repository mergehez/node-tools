import { createCommonJS } from 'mlly'
import { logError} from '../../../shared/src/helpers';
const { require } = createCommonJS(import.meta.url)

const sharp = require('sharp')
// import sharp from 'sharp'

export type SizeDefinition = {
    width?: number,
    height?: number,
    maxWidth?: number,
    maxHeight?: number,
    scale?: number,
};

export type ResizeImageOptions = SizeDefinition & {
    smooth?: boolean,
    type?: "jpeg" | "png",
    /** from 1 to 100 */
    quality?: number,
};

export type Size = {
    width: number,
    height: number,
};

export const defaultOptions = {
    smooth: true,
    type: "png",
};

export function getSize(imageSize: Size, { width, height, maxWidth, maxHeight, scale }: SizeDefinition): Size {
    if (width && height) {
        return { width, height };
    }

    const ratio = imageSize.width / imageSize.height;

    if(scale){
        width = Math.round(imageSize.width * scale);
        height = Math.round(imageSize.height * scale);
        return { width, height };
    }

    if (height) {
        const newWidth = Math.round(ratio * height);
        if (maxWidth && newWidth > maxWidth) {
            return getSize(imageSize, { width: maxWidth });
        } else {
            return { width: newWidth, height };
        }
    }
    if (width) {
        const newHeight = Math.round(width / ratio);
        if (maxHeight && newHeight > maxHeight) {
            return getSize(imageSize, { height: maxHeight });
        } else {
            return { width, height: newHeight };
        }
    }

    if (maxHeight && imageSize.height > maxHeight) {
        return getSize(imageSize, { height: maxHeight, maxWidth });
    }
    if (maxWidth && imageSize.width > maxWidth) {
        return getSize(imageSize, { width: maxWidth, maxHeight });
    }

    return imageSize;
}

export async function resizeImage(fileOrUrl: Buffer | string, options: ResizeImageOptions): Promise<{ buffer: Buffer, original_size: Size, final_size: Size }> {
    const opt = { ...defaultOptions, ...options };

    let image = sharp(fileOrUrl);
    const metadata = await image.metadata();

    // for jpeg and png is not possible not receive width and height
    const width = metadata.width || 32;
    const height = metadata.height || 32;

    const size = getSize({ width, height }, options);
    // logWarning(`Resizing ${fileOrUrl} from ${width}x${height} to ${size.width}x${size.height} with quality ${opt.quality}`);
    // sharp make all smooth resizes
    image = image.resize(size);

    switch (opt.type) {
        case "png":
            image = image.png({ quality: opt.quality });
            break;
        case "jpeg":
            image = image.jpeg({ quality: opt.quality });
            break;
    }

    return {
        buffer: await image.toBuffer(),
        original_size: { width, height } as Size,
        final_size: size
    };
}

const maxTryCount = 200;
export async function resizeUntilMaxSize(src: string, options: ResizeImageOptions, maxSize: number, tryCount = 0){
    try {
        const res = await resizeImage(src, {
            width: options["width"],
            height: options["height"],
            maxWidth: options["max-width"],
            maxHeight: options["max-height"],
            quality: options["quality"],
            smooth: options["smooth"],
            scale: options["scale"],
            type: src.endsWith('png') ? 'png' : 'jpeg'
        });
        if(res.buffer.length > maxSize){
            if(tryCount > maxTryCount){
                logError(`  Couldn't achieve max size of ${maxSize} bytes after ${maxTryCount} tries! (quality: ${options.quality}, scale: ${options.scale}, size: ${res.buffer.length} bytes)`);
                process.exit(1);
            }
            const newQuality = Math.round(options.quality * 0.9);
            if(newQuality < 10 || newQuality === options.quality){
                options.scale = (options.scale ?? 1) * 0.9;
                if(options.scale < 0.1){
                    logError(`  Couldn't achieve max size of ${maxSize} bytes after ${maxTryCount} tries! (quality: ${options.quality}, scale: ${options.scale}, size: ${res.buffer.length} bytes)`);
                    process.exit(1);
                }
            }else{
                options.quality = Math.round(options.quality * 0.9);
            }
            return await resizeUntilMaxSize(src, options, maxSize, tryCount+1);
        }
        return {
            ...res,
            tryCount
        };
    } catch (error) {
        logError(error);
        process.exit(1);
    }
}