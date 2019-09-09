# Box CI

This is the open-source [Box CI](https://boxci.dev) CLI

Use it to run your builds:

    > boxci 'your build command' [Options]

---

### Options
<br>

**Required**

```
--project       Project ID
-p
                Find on the project page on https://boxci.dev


--key           Project secret key
-k
                Find on the project page on https://boxci.dev
```

**Optional**

```
--label         Add a label to this build run
-l
                Provide the label name and value with the syntax --label key,value
                To provide multiple labels, repeat the option for each label.
                There is a limit of 32 characters for label names and 512
                characters for label values.


--silent        Do not display the build command output in the terminal.
-s
                Note, output will still be streamed to boxci.dev and
[false]         displayed on the build page. This option is only intended
                for convenience if you don't wish to see the ouput in the
                terminal when you run boxci.

                boxci` has no control over the output of your build commands.
                If you want to silence some or all of their output,
                you have to configure the commands appropriately.


--no-emojis     Do not show emojis in boxci messaging.
-ne
                As above, this does not affect output from your build commands.
[false]         If you want to stop your build commands outputting emojis,
                you will have to configure them appropriately.


--no-spinners    Do not show spinners in boxci messaging.
-ns
                As above, this does not affect output from your build commands.
[false]         If you want to stop your build commands showing spinners,
                you will have to configure them appropriately.
```


**Advanced**

```
--retries       Max retries for requests to the service.
-r
                Minimum 0 Maximum 100. If the retry count is exceeded,
[10]            boxci exits and the build will be cancelled. You may wish to
                use this if your network conditions are particularly
                unreliable.
```

---

### Config File - boxci.json

All options above can also be defined in a JSON config file named `boxci.json` in the same directory you run the `boxci` command from.

The format of `boxci.json` is as follows

```
{
  "project": "QWE123",
  "key": "ABCDEF123456",
  "labels": [
    { "name": "label-one", "value": "value-one" },
    { "name": "label-two", "value": "value-two" }
  ],
  "silent": false,
  "noEmojis": false,
  "noSpinners": false,
  "retries": 10
}
```

All options in `boxci.json` are **optional**. For the required options `project` and `key`, it's only required that they are provided *either* in `boxci.json` or directly to the `boxci` command.

___

### Examples
<br>

##### Run a build command and stream logs to project QWE123

```
> boxci 'npm run build' \
    --project QWE123 \
    --key ABCDEFG123456
```

##### Run as many commands you want, any valid shell commands work fine
```
> boxci 'cd ..; npm run test && npm run build' \
    --project QWE123 \
    --key ABCDEFG123456
```
##### Or for longer builds, just run a script
```
> boxci 'sh ./build.sh' \
    --project QWE123 \
    --key ABCDEFG123456
```
##### Add labels to a build run to attach meaningful metadata to it
```
> boxci 'sh ./build.sh' \
    --project X01X01 \
    --key ABCDEFG123456 \
    --label git-commit,$(git rev-parse HEAD) \
    --label git-branch,$(git rev-parse --abbrev-ref HEAD) \
    --label build-machine,my-laptop
```
##### Provide some config via `boxci.json`
```
For convenience you can provide some static config in boxci.json

That way you don't have to type the config every time you run boxci

BE AWARE - you probably do not want to commit this file
to source control if it contains your key, rather just
keep it on your local machine for convenience

--- boxci.json ---

{
  "project": "X01X01",
  "key": "ABCDEFG123456",
  "labels:: [{
    "name": "build-machine",
    "value": "my-laptop"
  }]
}


You can now run boxci from the same directory and it will work
without passing any options on the command line, because
both 'project' and 'key' are defined in boxci.json

> boxci 'your build command'

You can also supply extra options, in addition to
the ones defined in boxci.json, for example
dynamic labels or ones you only want to use
in certain circumstances like --silence or --no-spinners

> boxci 'your build command' \
    --label git-commit,$(git rev-parse HEAD) \
    --label git-branch,$(git rev-parse --abbrev-ref HEAD) \
    --silence \
    --no-spinners
```
