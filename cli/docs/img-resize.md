# img-resize

automate resizing images 

it minimizes php files in `storage/framework/views`

```shell
npx img-resize -i='(.*)-([0-9]+).jpg' -o='[name]-md.jpg' -s=0.6 --max-size=300kb # 300kb

npx img-resize -i='(.*)-([0-9]+).jpg' -o='[name]-min.jpg' -s=0.1 --max-size=10240 # 10kb
```


## Options

| option        | description                                               | required | default |
| ------------- | --------------------------------------------------------- | -------- | ------- |
| -i, --input   | Regex to find files. `[A-9` will be replaced as `[A-z0-9` | yes      | -       |
| -o, --output  | Rename pattern.                                           | yes      | -       |
| -w, --width   | width (px)                                                | no       | -       |
| -h, --height  | height (px)                                               | no       | -       |
| --max-width   | max width (px)                                            | no       | -       |
| --max-height  | max height (px)                                           | no       | -       |
| --max-size    | Max size in bytes                                         | no       | -       |
| -q, --quality | Quality (1 - 100)                                         | no       | 80      |
| -s, --scale   | Scale width/height (0.1 - 1)                              | no       | 1       |
| --smooth      | Smoother resize processing                                | no       | true    |

- at least one of these must be present: `--width`, `--height`,`--max-width`, `--max-height`, `--max-size`

## Notes

- `--input`
  - supported extensions: `.jpg`, `.jpeg` and `.png` 
  - if starts with `.` then the program prepends `(.*)` to it. Assuming that `--input` is something like `.jpg` and resizes all jpg images.
- `--output`
  - `[name]` is replaced by the name of image without extension. 
  - if `[name]` doesn't exists and starts with `-` or `_`, the program prepends `[name]` to it. 
  - if `name` and not starting with those characters: throw exception
  - if doesn't contain `.`: throw exception
- `--max-size`
  - you can use multiplication and division like `--max-size=2*1024` (2048 = 2 KB)
  - the value is in bytes. but you can use `kb` or `mb` at the end. like: `--max-size=2kb` or `--max-size="2 kb"`
  - you can combine them but must in order. like: `--max-size=2*2014kb` = (= 4 MB)