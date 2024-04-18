#!/usr/bin/env node

import {createExecuter} from "./services/base_executer";

const executer = await createExecuter();
await executer.start()
