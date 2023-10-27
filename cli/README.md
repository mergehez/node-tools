
##  Install

```bash
npm i --global @mergehez/cli

# yarn 
yarn add --global @mergehez/cli -D

# pnpm 
pnpm add --global @mergehez/cli -D
```

## Usage

### ftp-deploy
1. Add following information to your .env file:

```yaml
...
FTP_USERNAME=myusername
FTP_PASSWORD=mypassword
FTP_SERVER=127.0.0.1
FTP_TARGET_BASEPATH=test/mysite
...
```

2. Add this script to the `scripts` section of your `package.json`

```json
{
    ...
    "scripts" : {
        "deploy" : "npm ftp-deploy"
    }
}
```

3. Run `npm run deploy`

### git-switch
1. Run `npx git-switch` and you get instructions!

## License

[MIT](./LICENSE) License &copy; 2023-PRESENT [Mazlum Ozdogan](https://github.com/mergehez)