# Box CI Agent

The [Box CI](https://boxci.dev) agent is the open source tool you install on your build machines to run builds.

It does all the work of coordinating with the [Box CI Service](https://boxci.dev) - all you have to do is run it.

It's [open source](https://github.com/boxci/boxci), so you know exactly what is running on your machine.

---
**Install**

    > npm i -g boxci

This installs the Agent CLI globally as boxci on your build machine. Confirm the installation by running `boxci --version`.

The Agent CLI requires NodeJS v12+ on your build machine to install and run. This is to support as many platforms as possible, as seamlessly as possible.

---
**Usage**

The Agent CLI has commands for starting/stopping agents, and managing local build history and logs on the machine.

* [`boxci agent`](#agent)
* [`boxci stop`](#stop)
* [`boxci history`](#history)
* [`boxci logs`](#logs)
* [`boxci clean-logs`](#clean-logs)
* [`boxci --version`](#version)
* [`boxci --help`](#help)

For more detail & examples see [https://boxci.dev/docs/agent](https://boxci.dev/docs/agent)

---
### `boxci agent`<a name="agent"></a>

**Run an agent for a project.**

Specify the project ID and secret key with the `--project` and `--key` options.

Each agent can run one build at a time for the specified project. You can run as many agents as you want on a single machine or across different machines.

```
Options
  Required
    --project    -p   Project ID
    --key        -k   Project secret key
  Optional
    --machine    -m   Build machine name
    --silent     -s   No console output
    --ssh-host   -h   Use this host for ssh requests
```

---
### `boxci stop <agent>`<a name="stop"></a>

**Gracefully stop a running agent.**

```
Arguments
  Required
    agent              Name of the agent
```

---
### `boxci history`<a name="history"></a>

**View history of agents and builds run on this machine.**

```
Arguments
  Optional
    mode               One of the following 3 values:

                       'builds'     list history of all
                                    builds
                       'projects'   list history of builds
                                    grouped by project
                       'agents'     list history of builds
                                    grouped by agent

                       - OR -

                       leave blank to show an overview of
                       the numbers of builds, projects and
                       agents in the history
```

---
### `boxci logs <build>`<a name="logs"></a>

**Print the absolute path to the local log file for a build.**

```
Arguments
  Required
    build              ID of the build
```

___
### `boxci clean-logs`<a name="clean-logs"></a>

**Clean logs of builds on this machine.**

```
Options
  One Required
    --build       -b   A build ID
                       Clear logs for this build
    --project     -p   A Project ID
                       Clear logs of all builds for this
                       project
    --all         -a   Clear logs of all builds
```

---
### `boxci --version`<a name="version"></a>

**Show the currently installed version.**

---
### `boxci --help`<a name="help"></a>

**Show documentation.**

---

For more detail & examples see [https://boxci.dev/docs/agent](https://boxci.dev/docs/agent)