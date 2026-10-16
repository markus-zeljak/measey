"use strict";
const {spawnSync}=require("child_process");
const path=require("path");
const files=["curve-math.test.js","measey-host.test.js","controller-smoke.cjs","ui-smoke.cjs"];
let failed=false;
for(const file of files){const result=spawnSync(process.execPath,[path.join(__dirname,"..","tests",file)],{stdio:"inherit"});if(result.status!==0)failed=true;}
process.exitCode=failed?1:0;
