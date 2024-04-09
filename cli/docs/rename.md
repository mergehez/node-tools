# rename

```shell

npx rename -i='([A-9_ ]+)-([0-9]+).jpg' -o='img-$2.jpg'

npx rename -i='img-([A-z]+)-([0-9]+).jpg' -o='img-$1-$2.jpg'

```

## Options

| option       | description                                                                             |
| ------------ | --------------------------------------------------------------------------------------- |
| -i, --input  | Regex pattern to find files. `[A-9` will be replaced as `[A-z0-9`                       |
| -o, --output | Rename pattern. You can use `[i]` (index) and `[pos]` (position) as placeholder         |
| --dry        | skip comparing local files with remote files. (=upload all files. this takes more time) |
| --act        | print the shell commands without executing them                                         |
| --dry        | prints what will be rename, without renaming them. (original => new_name)               |
| --help       | print this message                                                                      |

## Notes
- `--output` has some special placeholders:

| placeholder | function                                        |
| ----------- | ----------------------------------------------- |
| [i]         | regex match index (starting from 0)             |
| [pos]       | index+1 (starting from 1)                       |
| $trim       | removes given text from left and right of name. |
| $triml      | remove only from left                           |
| $trimr      | remove only from right                          |

```shell
    # rename all jpeg files and append 0,1,2,3... to their name
    npx rename -i='([A-9]+).jpg' -o='img-[i].jpg'

    # rename all jpeg files and append 1,2,3,4... to their name
    npx rename -i='([A-9]+).jpg' -o='img-[pos].jpg'
    
    # img-back- 0100.jpg => img-back- 01.jpg    (trim 0's around second match (not third!))
    npx rename -i='img-([A-z]+)-([0-9]+).jpg' -o='img-$1-$trim(2, 0).jpg'

    # img-back-0100.jpg => img-back-1.jpg       (trim 0's again)
    npx rename -i='img-([A-z]+)-([0-9]+).jpg' -o='img-$1-$$trim(2, 0).jpg'

    # img-back- 0100.jpg => img-back-0100.jpg   (trim spaces)
    npx rename -i='img-([A-z]+)-([0-9]+).jpg' -o='img-$1-$$trim(2,).jpg'

    # img-back-0100.jpg => img-back-01.jpg      (trim 0's again from right)
    npx rename -i='img-([A-z]+)-([0-9]+).jpg' -o='img-$1-$$trimr(2, 0).jpg'

    # img-back-0100.jpg => img-back-100.jpg     (trim 0's again from left)
    npx rename -i='img-([A-z]+)-([0-9]+).jpg' -o='img-$1-$$triml(2, 0).jpg'


```