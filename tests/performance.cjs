"use strict";
// Read-only, reproducible selection/controller/UI benchmark. Native surfaces
// use the existing UI-smoke mocks; no Cavalry app or project is opened.
// node tests/performance.cjs --sizes=1000,5000 --types=out,both,custom
// --quick runs 1000 out keys; --json emits machine-readable phase counters.
// Timing is advisory. Math/host/state/path counters are deterministic evidence.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const crypto = require("crypto");
const {execFileSync} = require("child_process");
const {performance} = require("perf_hooks");
const root = path.resolve(__dirname,"..");
const flags = process.argv.slice(2);
function option(name,fallback) {
    const argument=flags.find(value=>value.startsWith("--"+name+"="));
    return argument ? argument.slice(name.length+3) : fallback;
}
const quick=flags.includes("--quick");
const sizes=option("sizes",quick?"1000":"1000,5000").split(",").map(Number);
const types=option("types",quick?"out":"out,both,custom").split(",");
const refreshes=Number(option("refreshes",quick?"1":"3"));
const hovers=Number(option("hovers",quick?"2":"10"));
const versions=option("versions","1.6.1,current").split(",");
for(const size of sizes)assert(Number.isInteger(size)&&size>0&&size<=100000,"Invalid benchmark size");
for(const type of types)assert(["in","out","both","custom"].includes(type),"Invalid expression type");
assert(Number.isInteger(refreshes)&&refreshes>=0&&Number.isInteger(hovers)&&hovers>=0,"Invalid repeat count");

const files=["curve-math.js","measey-host.js","measey-ui.js","measey-main.js"];
const sources={};
for(const version of versions){
    sources[version]={};
    for(const file of files){
        if(version==="current")sources[version][file]=fs.readFileSync(path.join(root,"src",file),"utf8");
        else {
            try { sources[version][file]=execFileSync("git",["show",(version.startsWith("v")?version:"v"+version)+":src/"+file],{cwd:root,encoding:"utf8",stdio:["ignore","pipe","ignore"]}); }
            catch(error){sources[version][file]=execFileSync("unzip",["-p",path.join(root,"archive","Measey-"+version.replace(/^v/,"")+".zip"),"Measey/src/"+file],{encoding:"utf8"});}
        }
    }
}
// Reuse the mock widgets, paths, geometry and timers already exercised by the
// UI suite. Extract only their setup, leaving assertions and source loading out.
const smoke=fs.readFileSync(path.join(__dirname,"ui-smoke.cjs"),"utf8");
const fixtureEnd=smoke.indexOf("const ctx=");
assert(fixtureEnd>0,"UI-smoke fixture marker changed");
const fixtureSource=smoke.slice(0,fixtureEnd)+
    "\nglobalThis.benchmarkFixture={ui,Path,Timer,Widget,widgets,timers};\n";
const results=[];

function run(version,count,type){
    const counters={stateReads:0,detectPower:0,compile:0,sample:0,evaluate:0,pow:0,log:0,sin:0,
        hostReads:0,dataReads:0,timesReads:0,attributeIdsReads:0,selectionIdsReads:0,
        redraws:0,paths:0,pathPoints:0,refreshes:0,writes:0};
    const phases=[];
    const model={count,type,expression:"",frame:0,data:[],ids:[],frames:[]};
    const trackedMath=Object.create(Math);
    for(const name of ["pow","log","sin"]){
        trackedMath[name]=function(...args){counters[name]++;return Math[name](...args);};
    }
    const context={require,console,Math:trackedMath};
    vm.createContext(context);
    vm.runInContext(fixtureSource,context,{filename:"benchmark-ui-fixture.js"});
    const fixture=context.benchmarkFixture;
    const ui=fixture.ui,events={};
    for(const name of ["setTitle","show"])ui[name]=()=>{};
    ui.addCallbackObject=object=>Object.assign(events,object);
    ui.Modal=class{showStringInput(){return undefined;}showMessage(){}};
    ui.chooseFileToOpen=()=>"";ui.chooseFileToSave=()=>"";
    const originalRedraw=fixture.Widget.prototype.redraw;
    fixture.Widget.prototype.redraw=function(...args){counters.redraws++;return originalRedraw.apply(this,args);};
    const originalAddPath=fixture.Widget.prototype.addPath;
    fixture.Widget.prototype.addPath=function(...args){counters.paths++;return originalAddPath.apply(this,args);};
    const NativePath=fixture.Path;
    context.cavalry={Path:class extends NativePath{
        point(...args){counters.pathPoints++;return super.point(...args);}
    }};
    const prefs={"measey.preferences.v1":{defaultsVersion:130,autoApply:false,applyOnDrag:false,
        applyOnDirection:false,syncExpression:true,powerSelected:type!=="custom",power:4,
        direction:type==="both"?"in out":type==="in"?"in":"out",bothMidpoint:0.5,bottom:0,top:0}};
    const api={
        Timer:fixture.Timer,hasPreferenceObject:key=>Object.hasOwn(prefs,key),
        getPreferenceObject:key=>JSON.parse(JSON.stringify(prefs[key])),
        setPreferenceObject:(key,value)=>{prefs[key]=JSON.parse(JSON.stringify(value));},
        getSelectedKeyframes:()=>({"basicShape#1.scale.x":model.frames.slice(0,count)}),
        getSelectedKeyframeIds:()=>{counters.selectionIdsReads++;return model.ids.slice(0,count);},
        getKeyframeTimes:()=>{counters.timesReads++;return model.frames.slice();},
        getKeyframeIdsForAttribute:()=>{counters.attributeIdsReads++;return model.ids.slice();},
        get:(id,attribute)=>{
            if(attribute==="data"){counters.dataReads++;return model.data[Number(id.slice(id.indexOf("#")+1))];}
            if(attribute==="frame")return Number(id.slice(id.indexOf("#")+1));
            return 24;
        },
        layerExists:()=>true,getActiveComp:()=>"composition#1",getFrame:()=>model.frame,
        setFrame:value=>{model.frame=value;},setClipboardText:()=>{},getFileSize:()=>1,
        writeToFile:()=>true,readFromFile:()=>"",
        set:()=>{counters.writes++;throw Error("Benchmark must not write keyframes");},
        magicEasing:()=>{counters.writes++;throw Error("Benchmark must not apply Magic Easing");}
    };
    context.api=api;context.ui=ui;
    function phase(name,operation){
        const before={...counters},start=performance.now();
        operation();
        const delta={};for(const key of Object.keys(counters))delta[key]=counters[key]-before[key];
        phases.push({phase:name,ms:Number((performance.now()-start).toFixed(3)),...delta});
    }
    let controller,panel;
    phase("initialize",()=>{
        vm.runInContext(sources[version]["curve-math.js"],context,{filename:"curve-math.js"});
        const math=context.MeaseyMath;
        model.expression=type==="custom" ? "x + .02*sin(2*PI*x)" : math.powerExpression(4,prefs["measey.preferences.v1"].direction);
        prefs["measey.preferences.v1"].customExpression=model.expression;
        for(let i=0;i<=count;i++){
            model.ids.push("keyframe#"+i);model.frames.push(i);
            model.data.push({numValue:i,interpolation:0,easing:34,exprEasing:model.expression,colorId:11});
        }
        for(const name of ["detectPower","sample"]){
            const original=math[name];
            math[name]=function(...args){counters[name]++;return original.apply(math,args);};
        }
        const originalCompile=math.compile;
        math.compile=function(...args){
            counters.compile++;const fn=originalCompile.apply(math,args);
            function evaluated(...values){counters.evaluate++;return fn(...values);}
            evaluated.expression=fn.expression;evaluated.source=fn.source;return evaluated;
        };
        vm.runInContext(sources[version]["measey-host.js"],context,{filename:"measey-host.js"});
        const originalRead=context.MeaseyHost.readSelection;
        context.MeaseyHost.readSelection=function(...args){counters.hostReads++;return originalRead.apply(this,args);};
        vm.runInContext(sources[version]["measey-ui.js"],context,{filename:"measey-ui.js"});
        const originalBuild=context.buildMeaseyUI;
        context.buildMeaseyUI=function(value,mathModule){
            controller=value;const originalState=controller.getState;
            controller.getState=function(...args){counters.stateReads++;return originalState.apply(this,args);};
            panel=originalBuild(controller,mathModule);
            const originalRefresh=panel.refresh;
            panel.refresh=function(...args){counters.refreshes++;return originalRefresh.apply(this,args);};
            return panel;
        };
        vm.runInContext(sources[version]["measey-main.js"],context,{filename:"measey-main.js"});
    });
    let state=controller.getState();
    assert.equal(state.selectedPowerLevels.length,count);
    if(state.selectionPreviewLimited!==undefined){
        assert.equal(state.selectionPreviewCurves.length,Math.min(10,count));
        assert.equal(state.selectionPreviewLimited,count>10);
        assert.deepEqual(Array.from(state.selectionPreviewCurves,curve=>curve.keyId),model.ids.slice(0,Math.min(10,count)));
    }
    assert.equal(state.canApplyPower,false,"An identical selected formula should already be applied");
    const graph=fixture.widgets.find(widget=>widget.kind==="Draw"&&widget.role==="graph");
    const graphHost=fixture.widgets.find(widget=>widget.kind==="Container"&&widget.layout&&widget.layout.children.includes(graph));
    assert(graphHost&&graphHost.onMouseMove,"Graph hover fixture missing");
    phase("stable-refresh",()=>{for(let i=0;i<refreshes;i++)panel.refresh();});
    const hoverPoint=type==="both" ? {x:graph.w/2,y:87} :
        type==="in" ? {x:graph.w/2,y:10} : type==="out" ? {x:graph.w/2,y:graph.h-10} : {x:20,y:87};
    phase("active-hover",()=>{
        // True enter/leave transitions force redraws for every version. Both
        // enters its guide; In/Out enter the active endpoint; custom enters its
        // graph without a Power handle. No drag or click can alter keyframes.
        for(let i=0;i<hovers;i++){graphHost.onMouseEnter(hoverPoint);graphHost.onMouseLeave();}
    });
    phase("same-selection",()=>events.onKeySelectionChanged());
    phase("changed-last-key",()=>{
        // Same selected ids, new data: caches must not suppress a real change.
        model.data[count-1].exprEasing="pow(x,7)";
        events.onAttrChanged("basicShape#1","scale.x");
        for(const timer of fixture.timers)if(timer.running&&!timer.repeating)timer.tick();
        state=controller.getState();assert.equal(state.canApplyPower,true,"Fresh same-id key data must invalidate the Apply match");
        assert.equal(state.selectedPowerLevels[count-1],7);
    });
    phase("restored-last-key",()=>{
        model.data[count-1].exprEasing=model.expression;
        events.onAttrChanged("basicShape#1","scale.x");
        for(const timer of fixture.timers)if(timer.running&&!timer.repeating)timer.tick();
        state=controller.getState();assert.equal(state.canApplyPower,false,"Restoring the formula must restore the Applied state");
    });
    phase("changed-last-color",()=>{
        model.data[count-1].colorId=16;
        events.onAttrChanged("basicShape#1","scale.x");
        for(const timer of fixture.timers)if(timer.running&&!timer.repeating)timer.tick();
        state=controller.getState();
        assert.equal(state.canApplyPower,version==="current","Current matching also requires the requested Plum color");
    });
    phase("restored-last-color",()=>{
        model.data[count-1].colorId=11;
        events.onAttrChanged("basicShape#1","scale.x");
        for(const timer of fixture.timers)if(timer.running&&!timer.repeating)timer.tick();
        state=controller.getState();assert.equal(state.canApplyPower,false,"Restoring Plum must restore the Applied state");
    });
    assert.equal(counters.writes,0,"Benchmark is read-only");
    ui.onClose();
    const total={};for(const key of Object.keys(counters))total[key]=counters[key];
    const result={version,keys:count,type,phases,totalMs:Number(phases.reduce((sum,item)=>sum+item.ms,0).toFixed(3)),total};
    results.push(result);
    if(!flags.includes("--json")){
        console.log(`${version} ${count} ${type}: ${result.totalMs}ms; detect=${total.detectPower}, compile=${total.compile}, state=${total.stateReads}, pow=${total.pow}, data=${total.dataReads}, redraw=${total.redraws}`);
        for(const item of phases)console.log(`  ${item.phase}: ${item.ms}ms; detect=${item.detectPower}, compile=${item.compile}, state=${item.stateReads}, data=${item.dataReads}, paths=${item.paths}, points=${item.pathPoints}`);
    }
    else if(flags.includes("--progress"))process.stderr.write(`${version} ${count} ${type}: ${result.totalMs}ms; compile=${total.compile}, detect=${total.detectPower}\n`);
}
for(const count of sizes)for(const type of types)for(const version of versions)run(version,count,type);
if(flags.includes("--json")){
    const hashes={};for(const version of versions)hashes[version]=crypto.createHash("sha256").update(files.map(file=>sources[version][file]).join("\n")).digest("hex");
    console.log(JSON.stringify({note:"Mock timing is advisory; counters include public math calls and underlying Math.pow/log/sin evaluations. No native Cavalry surfaces are used. Source hashes identify the captured math/host/UI/main versions; v1.6.1 is read from Git with archived-ZIP fallback.",generatedAt:new Date().toISOString(),refreshes,hovers,sourceHashes:hashes,results},null,2));
}
