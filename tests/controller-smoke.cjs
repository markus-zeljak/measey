"use strict";
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const math = require("../src/curve-math.js");

function harness(saved,mathOverride) {
    const timers = [], writes = [], events = {}, menu = [], actions = [], warnings = [],modalCalls=[],midpointOpens=[],weightOpens=[];
    const model = {ids:["key#1"],comp:"comp#1",expression:"x",failApply:false,emitReadEvent:false,readDepth:0,maxReadDepth:0,hostBusy:false};
    const prefs = JSON.parse(JSON.stringify(saved || {}));
    let controller, fileToOpen = "", fileSource = "";
    class Timer {
        constructor(config) { this.config = config; this.active = false; timers.push(this); }
        setInterval(n) { this.interval = n; }
        setRepeating(value) { this.repeating = value; }
        start() { this.active = true; }
        stop() { this.active = false; }
        fire() { if (!this.active) return; if (!this.repeating) this.active = false; this.config.onTimeout(); }
    }
    const api = {
        Timer, hasPreferenceObject:key=>Object.prototype.hasOwnProperty.call(prefs,key),
        getPreferenceObject:key=>JSON.parse(JSON.stringify(prefs[key])),
        setPreferenceObject:(key,value)=>{if(key==='measey.libraries.v1'&&model.failLibrarySave)throw Error('Simulated library save failure');prefs[key]=JSON.parse(JSON.stringify(value));writes.push({key,value:prefs[key]});},
        getSelectedKeyframeIds:()=>model.ids.slice(), getActiveComp:()=>model.comp,
        getFileSize:()=>1, readFromFile:()=>fileSource,
        writeToFile:()=>true, setClipboardText:()=>{}, get:()=>24
    };
    const ui = {
        setTitle:()=>{}, addCallbackObject:object=>Object.assign(events,object),show:()=>{},
        clearContextMenu:()=>{menu.length=0;},addMenuItem:item=>menu.push(item),showContextMenu:()=>{},
        chooseFileToOpen:()=>fileToOpen,chooseFileToSave:()=>"",
        Modal:class {showStringInput(...args){modalCalls.push(args);return Object.prototype.hasOwnProperty.call(model,'modalResponse')?model.modalResponse:"CUSTOM";}showMessage(){}}
    };
    const host = {
        isBusy:()=>model.hostBusy, colors:{clear:16,magic:11},
        readSelection:(mathModule,options)=>{
            model.readOptions=options;
            model.hostBusy = true; model.readDepth++; model.maxReadDepth=Math.max(model.maxReadDepth,model.readDepth);
            try {
                if(model.readDepth>20)throw Error("Recursive selection read");
                if(model.emitReadEvent && events.onSceneChanged)events.onSceneChanged();
                const active=model.magicActive===undefined?model.expression!=="x":model.magicActive;
                const magic={name:active?"Custom":"None",active,expression:model.nativeMagic?"":active?model.expression:""};
                const keys=model.ids.map(id=>{
                    const entry=(model.keyData||{})[id]||{},expression=entry.expression===undefined?model.expression:entry.expression;
                    const keyActive=entry.active===undefined?active:entry.active;
                    return {id,layerId:"shape#1",magic:{name:keyActive?"Custom":"None",active:keyActive,expression:keyActive?expression:""},data:{colorId:entry.colorId===undefined?(model.colorId===undefined?(keyActive?11:16):model.colorId):entry.colorId,interpolation:entry.interpolation===undefined?0:entry.interpolation}};
                });
                return {count:model.ids.length,expression:model.expression,mixed:!!model.mixed,
                    keys,
                    previewCurves:model.ids.length?(model.previewCurves||[{expression:model.expression}]):[],
                    segments:model.ids.length&&!model.terminal?[{magic}]:[],
                    message:"Selection read"};
            }finally{model.readDepth--;model.hostBusy=model.readDepth>0;}
        },
        apply:expression=>{
            if(!model.ids.length)return {changed:0,message:"Select keyframes to update."};
            if(model.failApply)throw Error("Simulated write failure");
            actions.push({type:"apply",ids:model.ids.slice(),comp:model.comp,expression});model.expression=expression;model.magicActive=true;model.colorId=11;model.keyData=model.keyData||{};model.ids.forEach(id=>model.keyData[id]={expression,active:true,colorId:11});
            if(events.onKeySelectionChanged)events.onKeySelectionChanged();
            if(events.onSceneChanged)events.onSceneChanged();
            return {changed:model.ids.length,message:"Applied"};
        },
        clear:()=>{if(model.ids.length)actions.push({type:"clear",ids:model.ids.slice(),colorId:16});model.expression="x";model.magicActive=false;model.colorId=16;model.keyData=model.keyData||{};model.ids.forEach(id=>model.keyData[id]={expression:"x",active:false,colorId:16});return {changed:model.ids.length,message:"Cleared"};},
        flatten:()=>{if(model.ids.length)actions.push({type:"flatten",ids:model.ids.slice()});model.expression="x";model.magicActive=false;model.colorId=16;model.keyData=model.keyData||{};model.ids.forEach(id=>model.keyData[id]={expression:"x",active:false,colorId:16});model.previewCurves=[{flattened:true,samples:[{x:0,y:0},{x:1,y:1}]}];return {changed:model.ids.length,message:"Flattened"};}
    };
    let refreshes=0;
    const context={api,ui,MeaseyHost:host,MeaseyMath:mathOverride||math,
        console:{warn:value=>warnings.push(value)},
        buildMeaseyUI:value=>{controller=value;return {refresh:()=>refreshes++,layoutChanged:()=>refreshes++,resize:()=>{},onClose:()=>{},openMidpointEditor:()=>midpointOpens.push(controller.getState().bothMidpoint),openWeightEditor:kind=>{weightOpens.push(kind);if(kind==="midpoint")midpointOpens.push(controller.getState().bothMidpoint);}};}};
    vm.runInNewContext(fs.readFileSync(__dirname+"/../src/measey-main.js","utf8"),context,{filename:"measey-main.js"});
    const libraryMenu=prefix=>{controller.showLibrarySettings();const item=menu.find(item=>item.name.trim().startsWith(prefix));assert.ok(item,"Missing library menu item: "+prefix);item.onMouseRelease();};
    const clickMenu=prefix=>{if(["Save Preset","New Library","Import Library","Export Current Library","List","Grid"].some(v=>prefix.startsWith(v)))return libraryMenu(prefix);controller.showSettings();const item=menu.find(item=>item.name.trim().startsWith(prefix));assert.ok(item,"Missing menu item: "+prefix);item.onMouseRelease();};
    return {controller,model,events,timers,actions,writes,prefs,warnings,ui,clickMenu,libraryMenu,menu,modalCalls,midpointOpens,weightOpens,
        importFile:raw=>{fileToOpen="mock.json";fileSource=JSON.stringify(raw);clickMenu("Import Library");},
        refreshes:()=>refreshes};
}

const tests=[];
function test(name,fn){tests.push({name,fn});}
test("invalid input never mutates or starts auto apply",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
    h.controller.editExpression("pow(x, 3)",false);assert.ok(h.timers[0].active);
    h.controller.editExpression("api.delete()",false);
    assert.equal(h.timers[0].active,false);h.timers[0].fire();h.controller.apply();
    assert.equal(h.actions.length,0);assert.match(h.controller.getState().status,/Unsupported|Unknown/);
});
test("valid auto apply occurs once after delay and preserves fresh selection",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
    h.controller.editExpression("t^3",false);assert.equal(h.actions.length,0);
    h.timers[0].fire();assert.equal(h.actions.length,1);assert.equal(h.actions[0].expression,"x ^ 3");
    h.timers[0].fire();assert.equal(h.actions.length,1);
});
test("committing an already applied typing draft does not write twice",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
    h.controller.editExpression("x^3",false);h.timers[0].fire();
    h.controller.editExpression(h.controller.getState().expression,true);
    assert.equal(h.actions.length,1,"Focus/Enter commit after delayed apply should not repeat a write");
});
test("selection and composition changes cancel delayed typing",()=>{
    for(const change of [h=>{h.model.ids=["key#2"];},h=>{h.model.comp="comp#2";}]){
        const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
        h.controller.editExpression("x^5",false);change(h);h.timers[0].fire();assert.equal(h.actions.length,0);
    }
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
    h.controller.editExpression("x^4",false);h.model.ids=["key#2"];h.events.onKeySelectionChanged();
    assert.equal(h.timers[0].active,false);h.timers[0].fire();assert.equal(h.actions.length,0);
});
test("empty selection allows preview without mutation",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
    h.model.ids=[];h.events.onKeySelectionChanged();h.controller.editExpression("x^3",false);h.timers[0].fire();
    h.controller.apply();h.controller.clear();h.controller.flatten();
    assert.equal(h.actions.length,0);assert.equal(h.controller.getState().canApply,false);
});
test("settings persist and disabling auto apply cancels pending edits",()=>{
    const h=harness();h.clickMenu("Apply on type");assert.equal(h.prefs["measey.preferences.v1"].autoApply,true);
    h.controller.editExpression("x^3",false);assert.ok(h.timers[0].active);
    h.clickMenu("Apply on type");assert.equal(h.timers[0].active,false);
    h.clickMenu("List");h.controller.savePreferences({graphHeight:1240,mode:"speed"});
    const saved=h.prefs["measey.preferences.v1"];
    assert.equal(saved.layout,"list");assert.equal(saved.graphHeight,1240);assert.equal(saved.mode,"speed");
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().layout,"list");
    assert.equal(restarted.controller.getState().graphHeight,1240);assert.equal(restarted.controller.getState().mode,"speed");
    assert.equal(harness({"measey.preferences.v1":{graphHeight:100}}).controller.getState().graphHeight,120);
});
test("errors are reported and pending writes stop",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
    h.model.failApply=true;h.controller.editExpression("x^3",false);h.timers[0].fire();
    assert.equal(h.actions.length,0);assert.equal(h.timers[0].active,false);
    assert.match(h.controller.getState().status,/Simulated write failure/);
    assert.equal(h.controller.getState().expression,"x^3","Failed write should preserve the typed expression for retry");
    h.model.failApply=false;h.controller.apply();assert.equal(h.actions.length,1);
});
test("close cancels both timers and later callbacks",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
    h.controller.editExpression("x^3",false);h.ui.onClose();h.timers[0].fire();h.events.onKeySelectionChanged();
    assert.equal(h.actions.length,0);assert.equal(h.timers[0].active,false);assert.equal(h.timers[1].active,false);
});
test("imported default clear preset keeps clearing semantics",()=>{
    const h=harness();h.importFile({name:"USER CURVES",presets:[{name:"CLEAR",expression:"x",clear:true}]});
    const clear=h.controller.getPresets().find(p=>p.name==="CLEAR");assert.ok(clear);
    h.controller.selectPreset(clear.id);
    assert.equal(h.actions.length,1);assert.equal(h.actions[0].type,"clear");
});
test("host read callbacks do not recursively refresh selection",()=>{
    const h=harness();h.model.emitReadEvent=true;h.controller.getSelection();
    assert.equal(h.model.maxReadDepth,1,"Host read should be guarded from its own synchronous callbacks");
});
test("selected terminal Magic key can be flattened and ordinary keys cannot",()=>{
    const h=harness();assert.equal(h.controller.getState().canFlatten,false);
    h.model.terminal=true;h.model.expression="x^3";h.events.onKeySelectionChanged();
    assert.equal(h.controller.getState().canFlatten,true);
    h.controller.flatten();assert.equal(h.actions[0].type,"flatten");
});
test("custom field stays independent across power, direction, presets, selection, clear and flatten",()=>{
    const custom="x + sin(PI*x)*0.1",h=harness({"measey.preferences.v1":{syncExpression:false}});
    h.controller.editExpression(custom,false);
    const operations=[
        ()=>h.controller.setPower(2.5,true),
        ()=>h.controller.setDirection("in out"),
        ()=>{h.importFile({name:"MY CURVES",presets:[{name:"POWER SEVEN",expression:math.powerExpression(7,"in"),power:7,type:"in"}]});h.controller.selectPreset(h.controller.getPresets()[0].id);},
        ()=>{h.model.ids=["key#2"];h.model.expression="pow(x, 5)";h.events.onKeySelectionChanged();},
        ()=>h.events.onCompChanged(),()=>h.events.onSceneChanged(),
        ()=>h.controller.clear(),()=>h.controller.flatten()
    ];
    for(const operation of operations){operation();assert.equal(h.controller.getState().expression,custom);assert.equal(h.prefs["measey.preferences.v1"].customExpression,custom);}
});
test("only explicit Get loads selected formulas or native Magic into the custom field",()=>{
    const h=harness({"measey.preferences.v1":{syncExpression:false,powerSelected:true,customExpression:"x^2"}});
    h.model.expression="pow(x, 6)";h.events.onKeySelectionChanged();
    assert.equal(h.controller.getState().expression,"x^2");assert.equal(h.controller.getState().activeExpression,"pow(x, 6)");
    h.controller.getSelection();assert.equal(h.controller.getState().expression,"pow(x, 6)");
    assert.equal(h.prefs["measey.preferences.v1"].customExpression,"pow(x, 6)");
    h.model.expression="";h.model.nativeMagic=true;h.events.onSceneChanged();
    assert.equal(h.controller.getState().expression,"pow(x, 6)");
    h.controller.getSelection();assert.equal(h.controller.getState().expression,"");assert.equal(h.controller.getState().nativeMagic,true);
});
test("generated power and direction apply even when custom typing auto apply is off",()=>{
    const h=harness({"measey.preferences.v1":{autoApply:false,syncExpression:false}});
    h.controller.editExpression("x^2",false);assert.equal(h.actions.length,0);
    h.controller.setPower(2.75,true,"numeric");assert.equal(h.actions.length,1);
    assert.equal(h.actions[0].expression,math.powerExpression(2.75,"in"));
    h.clickMenu("Apply on direction");h.controller.setDirection("in out");assert.equal(h.actions.length,2);
    assert.equal(h.actions[1].expression,math.powerExpression(2.75,"in out"));
    assert.equal(h.controller.getState().expression,"x^2");assert.equal(h.controller.getState().autoApply,false);
});
test("power changes cancel pending custom automatic writes",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true,syncExpression:false}});
    h.controller.editExpression("x^9",false);assert.ok(h.timers[0].active);
    h.controller.setPower(4.5,true,"numeric");assert.equal(h.actions.length,1);
    assert.equal(h.actions[0].expression,math.powerExpression(4.5,"in"));
    h.timers[0].fire();assert.equal(h.actions.length,1);assert.equal(h.controller.getState().expression,"x^9");
});
test("slider edits debounce to the latest power independently of custom auto setting",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,applyOnDrag:true}});h.controller.setPower(2,false,"slider");h.controller.setPower(4,false,"slider");
    assert.equal(h.actions.length,0);assert.ok(h.timers[0].active);h.timers[0].fire();
    assert.equal(h.actions.length,1);assert.equal(h.actions[0].expression,math.powerExpression(4,"out"));
    h.controller.setPower(4,true,"slider");assert.equal(h.actions.length,1,"Slider release after auto apply should not duplicate a write");
});
test("slider debounce never writes to a changed key selection or composition",()=>{
    for(const change of [h=>{h.model.ids=["key#2"];},h=>{h.model.comp="comp#2";}]){
        const h=harness({"measey.preferences.v1":{defaultsVersion:130,applyOnDrag:true}});h.controller.setPower(6,false,"slider");change(h);h.timers[0].fire();assert.equal(h.actions.length,0);
    }
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,applyOnDrag:true}});h.controller.setPower(6,false,"slider");h.model.ids=[];h.events.onKeySelectionChanged();h.timers[0].fire();assert.equal(h.actions.length,0);
});
test("repeated power applies again after a custom formula replaces selected easing",()=>{
    const h=harness();h.controller.setPower(3.5,true,"numeric");assert.equal(h.actions.length,1);
    h.controller.editExpression("x^8",false);h.controller.apply();assert.equal(h.actions.length,2);
    h.controller.setPower(3.5,true,"numeric");assert.equal(h.actions.length,3);
    assert.equal(h.actions[2].expression,math.powerExpression(3.5,"in"));
});
test("committing custom formula again after generated power replaces easing applies it",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
    h.controller.editExpression("x^8",true);assert.equal(h.actions.length,1);
    h.controller.setPower(3.5,true,"numeric");assert.equal(h.actions.length,2);
    h.controller.editExpression("x^8",true);assert.equal(h.actions.length,3);
    assert.equal(h.actions[2].expression,"x ^ 8");
});
test("custom auto commit follows a new selection even if the field text is unchanged",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
    h.controller.editExpression("x^8",true);h.model.ids=["key#2"];h.model.expression="x";h.events.onKeySelectionChanged();
    h.controller.editExpression("x^8",true);assert.equal(h.actions.length,2);assert.deepEqual(h.actions[1].ids,["key#2"]);
});
test("user presets preserve metadata through import while default library stays empty",()=>{
    const h=harness({"measey.preferences.v1":{syncExpression:false,powerSelected:true,customExpression:"x^2"}});
    assert.equal(h.controller.getPresets().length,0);assert.equal(h.controller.getState().libraryName,"MY LIBRARY");
    h.importFile({name:"User Curves",presets:[{name:"SEVEN",type:"in out",power:7,expression:math.powerExpression(7,"in out")},{name:"CLEAR",expression:"x",clear:true},{name:"CUSTOM",expression:"x^2"}]});
    assert.equal(h.controller.getPresets().length,3);assert.equal(h.controller.getState().libraryName,"User Curves");
    const chosen=h.controller.getPresets().find(p=>p.name==="SEVEN");assert.ok(chosen);assert.equal(chosen.power,7);
    h.controller.selectPreset(chosen.id);assert.equal(h.controller.getState().power,7);assert.equal(h.controller.getState().direction,"in out");
    assert.equal(h.controller.getState().expression,"x^2");assert.equal(h.actions[0].type,"apply");
    assert.equal(math.compile(h.actions[0].expression).expression,math.compile(math.powerExpression(7,"in out")).expression);
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().libraryName,"User Curves");assert.equal(restarted.controller.getPresets().length,3);
});
test("malformed imported power metadata cannot corrupt the direction control",()=>{
    const h=harness();h.importFile({name:"ODD",presets:[{name:"BAD TYPE",expression:"x",type:"sideways",power:3}]});
    const chosen=h.controller.getPresets()[0];h.controller.selectPreset(chosen.id);
    assert.ok(["in","out","in out"].includes(h.controller.getState().direction));
    assert.doesNotThrow(()=>h.controller.setPower(2.5,true));
    const mismatch=harness();mismatch.importFile({name:"MISMATCH",presets:[{name:"CUSTOM LINEAR",expression:"x",type:"in",power:3}]});
    const custom=mismatch.controller.getPresets()[0];assert.equal(custom.power,undefined);
    mismatch.controller.selectPreset(custom.id);assert.equal(mismatch.controller.getState().power,1);assert.equal(mismatch.controller.getState().direction,"in");
});
test("power bounds, fractional values and independent controls persist on restart",()=>{
    const h=harness({"measey.preferences.v1":{power:-1,direction:"sideways",syncExpression:false,powerSelected:true,customExpression:"x^2"}});
    assert.equal(h.controller.getState().power,4);assert.equal(h.controller.getState().direction,"out");
    for(const value of [0,-1,0.9,Infinity,NaN,""]){h.controller.setPower(value,true,"numeric");assert.equal(h.actions.length,0);assert.equal(h.controller.getState().power,4);}
    h.controller.setPower(1.25,true,"numeric");h.controller.setDirection("in out");
    assert.equal(h.controller.getState().power,1.25);assert.equal(h.controller.getState().expression,"x^2");
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().power,1.25);
    assert.equal(restarted.controller.getState().direction,"in out");assert.equal(restarted.controller.getState().expression,"x^2");
    h.controller.setPower(12,true);assert.equal(h.controller.getState().power,12);
});
test("Apply on drag off leaves slider moves and release as previews until Power Apply",()=>{
    const h=harness({"measey.preferences.v1":{applyOnDrag:false,syncExpression:false,powerSelected:true,customExpression:"x^2"}});
    h.controller.setPower(3.25,false,"slider");assert.equal(h.controller.getState().power,3);
    assert.equal(h.actions.length,0);assert.equal(h.timers[0].active,false);
    h.controller.setPower(3.25,true,"slider");h.timers[0].fire();assert.equal(h.actions.length,0);
    assert.equal(h.controller.getState().canApplyPower,true);assert.equal(h.controller.getState().expression,"x^2");
    h.controller.applyPower();assert.equal(h.actions.length,1);
    assert.equal(h.actions[0].expression,math.powerExpression(3,"out"));assert.equal(h.controller.getState().canApplyPower,false);
});
test("enabled direction application and committed numeric entry apply when dragging is manual",()=>{
    const h=harness({"measey.preferences.v1":{applyOnDrag:false,autoApply:false}});
    h.clickMenu("Apply on direction");h.controller.setDirection("in");assert.equal(h.actions.length,1);assert.equal(h.actions[0].expression,math.powerExpression(4,"in"));
    h.controller.setPower(5.55,true,"numeric");assert.equal(h.actions.length,2);assert.equal(h.actions[1].expression,math.powerExpression(5.55,"in"));
    h.controller.setPower(6.2,false,"numeric");assert.equal(h.actions.length,2);assert.equal(h.timers[0].active,false);
});
test("Apply on drag cancellation and Apply on type remain independent",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,applyOnDrag:true,autoApply:true}});
    h.controller.setPower(3,false,"slider");assert.equal(h.timers[0].active,true);
    h.clickMenu("Apply on drag");assert.equal(h.timers[0].active,false);h.timers[0].fire();assert.equal(h.actions.length,0);
    h.controller.editExpression("x^2",false);assert.equal(h.timers[0].active,true);
    h.clickMenu("Apply on drag");assert.equal(h.timers[0].active,true);h.timers[0].fire();assert.equal(h.actions.length,1);
    h.controller.setPower(5,false,"slider");assert.equal(h.timers[0].active,true);
    h.clickMenu("Apply on type");assert.equal(h.timers[0].active,true);h.timers[0].fire();assert.equal(h.actions.length,2);
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().applyOnDrag,true);assert.equal(restarted.controller.getState().autoApply,false);
});
test("Power 1 clears Magic and sets Silver instead of writing Custom linear",()=>{
    const h=harness({"measey.preferences.v1":{syncExpression:false,powerSelected:true,customExpression:"x^2"}});
    h.model.expression="x^3";h.events.onKeySelectionChanged();h.controller.setPower(1,true,"numeric");
    assert.equal(h.actions.length,1);assert.equal(h.actions[0].type,"clear");assert.equal(h.actions[0].colorId,16);
    assert.equal(h.controller.getState().canApplyPower,false);assert.equal(h.controller.getState().expression,"x^2");
    h.model.colorId=11;h.model.keyData={};h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,true);
    h.controller.applyPower();assert.equal(h.actions[1].type,"clear");assert.equal(h.controller.getState().canApplyPower,false);
});
test("Power Apply checks every selected key and recognizes equivalent mathematical syntax",()=>{
    const h=harness({"measey.preferences.v1":{power:3,direction:"in",applyOnDrag:false}});
    h.model.ids=["key#1","key#2"];h.model.expression="pow(x,3)";h.model.magicActive=true;
    h.model.keyData={"key#1":{expression:"pow(x, 3)",active:true},"key#2":{expression:"t ^ 3",active:true}};
    h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,false);h.controller.applyPower();assert.equal(h.actions.length,0);
    h.model.keyData["key#2"].expression="x^4";h.model.mixed=true;h.events.onKeySelectionChanged();
    assert.equal(h.controller.getState().canApplyPower,true);h.controller.applyPower();assert.equal(h.actions.length,1);
    assert.deepEqual(h.actions[0].ids,["key#1","key#2"]);assert.equal(h.controller.getState().canApplyPower,false);
    h.model.ids=[];h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,false);h.controller.applyPower();assert.equal(h.actions.length,1);
});
test("native Magic or Step keys still need a requested power correction",()=>{
    const h=harness({"measey.preferences.v1":{power:3,direction:"in"}});
    h.model.expression="";h.model.magicActive=true;h.model.nativeMagic=true;h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,true);
    h.model.nativeMagic=false;h.model.expression="x^3";h.model.keyData={"key#1":{expression:"x^3",active:true,interpolation:2}};
    h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,true);
});
test("attribute refresh updates Power matching during a custom draft without replacing its preview",()=>{
    const h=harness({"measey.preferences.v1":{power:3,direction:"in",syncExpression:false}}),custom="x ^ 3";
    h.model.expression="pow(x,3)";h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,false);
    h.controller.editExpression(custom,false);const preview=JSON.stringify(h.controller.getState().previewCurves);
    h.model.expression="pow(x,4)";h.events.onAttrChanged("shape#1","rotation");assert.ok(h.timers[1].active);
    h.timers[1].fire();assert.equal(h.controller.getState().canApplyPower,true);
    assert.equal(h.controller.getState().expression,custom);assert.equal(h.controller.getState().activeExpression,"x ^ 3");
    assert.equal(JSON.stringify(h.controller.getState().previewCurves),preview);
    h.clickMenu("Apply on direction");h.controller.setDirection("in");assert.equal(h.actions.length,1);assert.equal(h.actions[0].expression,math.powerExpression(3,"in"));
    assert.equal(h.controller.getState().expression,custom);assert.equal(h.controller.getState().canApplyPower,false);
});
test("explicit Power actions read same-selection key data before a pending attribute refresh",()=>{
    for(const action of [h=>h.controller.applyPower(),h=>h.controller.setDirection("in")]){
        const h=harness({"measey.preferences.v1":{power:3,direction:"in",syncExpression:false}}),custom="x ^ 3";
        h.model.expression="pow(x,3)";h.events.onKeySelectionChanged();h.controller.editExpression(custom,false);
        h.model.expression="pow(x,4)";h.events.onAttrChanged("shape#1","rotation");assert.ok(h.timers[1].active);
        assert.equal(h.controller.getState().canApplyPower,false,"The cached snapshot has not refreshed yet");
        h.clickMenu("Apply on direction");action(h);assert.equal(h.actions.length,1);assert.equal(h.actions[0].expression,math.powerExpression(3,"in"));
        h.timers[1].fire();assert.equal(h.actions.length,1);assert.equal(h.controller.getState().expression,custom);
        assert.equal(h.controller.getState().canApplyPower,false);
    }
});
test("refreshing matching key data preserves a pending custom automatic edit",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true,power:3,direction:"in"}});
    h.model.expression="pow(x,3)";h.events.onKeySelectionChanged();h.controller.editExpression("x^7",false);
    h.model.expression="pow(x,4)";h.events.onAttrChanged("shape#1","rotation");h.timers[1].fire();
    assert.ok(h.timers[0].active);assert.equal(h.controller.getState().canApplyPower,true);
    h.timers[0].fire();assert.equal(h.actions.length,1);assert.equal(h.actions[0].expression,"x ^ 7");
    assert.equal(h.controller.getState().expression,"x^7");
});
test("library settings own preset management and layout while custom settings own application",()=>{
    const h=harness();h.controller.showSettings();
    const custom=h.menu.map(item=>item.name);assert.ok(custom.some(name=>name.startsWith("Apply on type")));assert.ok(custom.some(name=>name.startsWith("Apply on drag")));
    assert.ok(custom.some(name=>name.startsWith("Measey Version 1.6.3")));assert.ok(custom.includes("Expression Help"));
    assert.equal(custom.filter(name=>name.trim()).length,6);
    assert.ok(!custom.some(name=>/Copy|Reset Graph|Magic keys/.test(name)));
    assert.ok(!custom.some(name=>/Save Preset|New Library|Import Library|Export Current Library|Preset layout|POWER PRESETS/.test(name)));
    h.controller.showLibrarySettings();const library=h.menu.map(item=>item.name);
    for(const prefix of ["Save Preset","New Library","Import Library","Export Current Library","Preset layout"])assert.ok(library.some(name=>name.startsWith(prefix)));
    assert.ok(!library.some(name=>/Apply on type|Apply on drag|POWER PRESETS|DEFAULT PRESETS/.test(name)));
});
test("empty libraries, selected library and user-saved presets persist without built-ins",()=>{
    const h=harness({"measey.preferences.v1":{applyOnDrag:false,syncExpression:false,powerSelected:true,customExpression:"x^2"}});
    assert.equal(h.controller.getPresets().length,0);h.controller.setPower(5.3,false,"numeric");h.libraryMenu("Save Preset");
    assert.equal(h.controller.getPresets().length,1);assert.equal(h.controller.getPresets()[0].power,5.3);
    assert.equal(h.controller.getState().expression,"x^2");h.libraryMenu("New Library");assert.equal(h.controller.getPresets().length,0);
    assert.equal(h.controller.getState().libraryName,"CUSTOM");
    h.libraryMenu("MY LIBRARY");assert.equal(h.controller.getPresets().length,1);
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().libraryName,"MY LIBRARY");assert.equal(restarted.controller.getPresets().length,1);
});
test("imported Power 1 user preset clears and retains custom text",()=>{
    const h=harness({"measey.preferences.v1":{syncExpression:false,powerSelected:true,customExpression:"x^2"}});
    h.model.expression="x^5";h.events.onKeySelectionChanged();
    h.importFile({name:"User Linear",presets:[{name:"LINEAR",power:1,type:"out",expression:"x",clear:false}]});
    h.controller.selectPreset(h.controller.getPresets()[0].id);assert.equal(h.actions[0].type,"clear");
    assert.equal(h.controller.getState().power,1);assert.equal(h.controller.getState().canApplyPower,false);assert.equal(h.controller.getState().expression,"x^2");
});
test("new defaults and one-time migration turn both automatic options off then preserve later choices",()=>{
    const fresh=harness();assert.equal(fresh.controller.getState().autoApply,false);assert.equal(fresh.controller.getState().applyOnDrag,false);
    assert.equal(fresh.prefs["measey.preferences.v1"].defaultsVersion,130);
    fresh.controller.editExpression("x^3",false);fresh.controller.setPower(5,true,"slider");fresh.timers[0].fire();assert.equal(fresh.actions.length,0);
    const migrated=harness({"measey.preferences.v1":{autoApply:true,applyOnDrag:true,power:1.539,direction:"in out",syncExpression:false,powerSelected:true,customExpression:"x^7",graphHeight:1240}});
    assert.equal(migrated.controller.getState().autoApply,false);assert.equal(migrated.controller.getState().applyOnDrag,false);
    assert.equal(migrated.controller.getState().power,1.539);assert.equal(migrated.controller.getState().direction,"in out");
    assert.equal(migrated.controller.getState().expression,"x^7");assert.equal(migrated.controller.getState().graphHeight,1240);
    assert.equal(migrated.prefs["measey.preferences.v1"].defaultsVersion,130);
    migrated.clickMenu("Apply on type");migrated.clickMenu("Apply on drag");
    const restarted=harness(migrated.prefs);assert.equal(restarted.controller.getState().autoApply,true);assert.equal(restarted.controller.getState().applyOnDrag,true);
    assert.equal(restarted.writes.length,0,"The defaults migration runs only once");
});
test("typed Power preserves point and comma precision in applications, matching and preferences",()=>{
    const h=harness({"measey.preferences.v1":{syncExpression:false,powerSelected:true,customExpression:"x^7"}});
    h.controller.setPower("1.539",true,"numeric");assert.equal(h.controller.getState().power,1.539);
    assert.equal(h.actions[0].expression,math.powerExpression(1.539,"out"));assert.equal(h.controller.getState().canApplyPower,false);
    h.controller.setPower(" 1,539 ",true,"numeric");assert.equal(h.controller.getState().power,1.539);assert.equal(h.actions.length,1,"Equivalent comma input does not repeat an application");
    h.clickMenu("Apply on direction");h.controller.setDirection("in out");assert.equal(h.actions[1].expression,math.powerExpression(1.539,"in out"));
    assert.equal(h.controller.getState().expression,"x^7");assert.equal(h.prefs["measey.preferences.v1"].power,1.539);
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().power,1.539);
    h.controller.setPower("12,0",true,"numeric");assert.equal(h.controller.getState().power,12);
});
test("typed Power rejects malformed decimal input and out-of-range values without changing the curve",()=>{
    const h=harness();
    for(const value of ["", " ","1.","1,","1.539.0","1,539.0","1,5,3","1e1","0xA","1foo","NaN","Infinity","0.9999","-1","+2",true,{},[],null,undefined]){
        h.controller.setPower(value,true,"numeric");assert.equal(h.controller.getState().power,4);assert.equal(h.actions.length,0);
    }
    const auto=harness({"measey.preferences.v1":{defaultsVersion:130,applyOnDrag:true}});
    auto.controller.setPower(5,false,"slider");assert.ok(auto.timers[0].active);
    auto.controller.setPower("1,5,3",true,"numeric");assert.equal(auto.timers[0].active,false);auto.timers[0].fire();assert.equal(auto.actions.length,0);
});
test("slider Power stays integer while numeric input retains its fraction",()=>{
    const h=harness();h.controller.setPower("1,539",false,"numeric");assert.equal(h.controller.getState().power,1.539);
    for(let value=1;value<=12;value++){h.controller.setPower(value,false,"slider");assert.equal(h.controller.getState().power,value);}
    h.controller.setPower(3.6,false,"slider");assert.equal(h.controller.getState().power,4);assert.equal(h.actions.length,0);
    h.controller.setPower("3.6",false,"numeric");assert.equal(h.controller.getState().power,3.6);assert.equal(h.actions.length,0);
});
test("user libraries retain precise Power metadata through import, save and restart",()=>{
    const h=harness();h.importFile({name:"PRECISE",presets:[{name:"FRACTION",power:1.539,type:"out",expression:math.powerExpression(1.539,"out")}]});
    const preset=h.controller.getPresets()[0];assert.equal(preset.power,1.539);h.controller.selectPreset(preset.id);
    assert.equal(h.controller.getState().power,1.539);assert.equal(math.compile(h.actions[0].expression).expression,math.compile(math.powerExpression(1.539,"out")).expression);
    h.controller.setPower("2,7631",false,"numeric");h.libraryMenu("Save Preset");assert.equal(h.controller.getPresets()[1].power,2.7631);
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().power,2.7631);
    assert.equal(restarted.controller.getPresets()[0].power,1.539);assert.equal(restarted.controller.getPresets()[1].power,2.7631);
});
test("deleting a preset persists only the current library and clears its selected marker",()=>{
    const h=harness({"measey.preferences.v1":{syncExpression:false,powerSelected:true,customExpression:"x^7"}});
    h.importFile({libraries:[{name:"A",presets:[{name:"TWO",expression:"x^2"},{name:"THREE",expression:"x^3"}]},{name:"B",presets:[{name:"FOUR",expression:"x^4"}]}]});
    h.libraryMenu("A");const chosen=h.controller.getPresets()[0];h.controller.selectPreset(chosen.id);assert.equal(h.controller.getState().selectedPreset,chosen.id);
    const actions=h.actions.length;h.controller.deletePreset(chosen.id);assert.equal(h.actions.length,actions);
    assert.equal(h.controller.getState().selectedPreset,null);assert.equal(h.controller.getPresets().length,1);assert.equal(h.controller.getPresets()[0].name,"THREE");
    assert.equal(h.controller.getState().expression,"x^7");const writes=h.writes.length;h.controller.deletePreset("missing");assert.equal(h.writes.length,writes);
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().libraryName,"A");assert.equal(restarted.controller.getPresets().length,1);assert.equal(restarted.controller.getPresets()[0].name,"THREE");
    restarted.libraryMenu("B");assert.equal(restarted.controller.getPresets().length,1);assert.equal(restarted.controller.getPresets()[0].name,"FOUR");
});
test("failed preset deletion keeps the saved preset and current selection intact",()=>{
    const h=harness();h.importFile({name:"USER",presets:[{name:"TWO",expression:"x^2"}]});
    const chosen=h.controller.getPresets()[0];h.controller.selectPreset(chosen.id);h.model.failLibrarySave=true;
    h.controller.deletePreset(chosen.id);assert.equal(h.controller.getPresets().length,1);assert.equal(h.controller.getState().selectedPreset,chosen.id);
    assert.match(h.controller.getState().status,/Delete failed.*Simulated library save failure/);
    assert.equal(harness(h.prefs).controller.getPresets().length,1);
});
test("selected overlays survive typing recognition and manual Power changes",()=>{
    const h=harness({"measey.preferences.v1":{syncExpression:false,powerSelected:true,customExpression:"x^7"}});
    h.model.expression="x^2";h.model.previewCurves=[{keyId:"key#1",expression:"x^2",samples:[{x:0,y:0},{x:1,y:1}]}];h.events.onKeySelectionChanged();
    const selected=JSON.stringify(h.controller.getState().selectionPreviewCurves);
    assert.equal(h.controller.getState().powerExpression,math.powerExpression(4,"out"));
    h.controller.editExpression("x^8",false);assert.equal(h.controller.getState().powerExpression,math.powerExpression(8,"in"));
    h.controller.setPower(6,false,"slider");assert.equal(h.controller.getState().powerExpression,math.powerExpression(6,"in"));
    assert.equal(JSON.stringify(h.controller.getState().selectionPreviewCurves),selected);assert.equal(h.controller.getState().expression,"x^8");
    const custom="x+sin(PI*x)*0.1";h.controller.editExpression(custom,false);h.model.expression="x^3";h.model.previewCurves=[{keyId:"key#1",expression:"x^3"}];h.events.onAttrChanged("shape#1","rotation");h.timers[1].fire();
    assert.equal(h.controller.getState().selectionPreviewCurves[0].expression,"x^3");assert.equal(h.controller.getState().powerSelected,false);
    assert.equal(h.controller.getState().powerExpression,math.compile(custom).expression);assert.equal(h.controller.getState().expression,custom);
    h.model.previewCurves=null;h.clickMenu("Apply on direction");h.controller.setDirection("in");assert.equal(h.controller.getState().selectionPreviewCurves[0].expression,math.powerExpression(6,"in"));
    h.controller.clear();assert.equal(h.controller.getState().selectionPreviewCurves[0].expression,"x");
    h.model.ids=[];h.events.onKeySelectionChanged();assert.equal(h.controller.getState().selectionPreviewCurves.length,0);assert.equal(h.controller.getState().selectedPowerLevels.length,0);
});
test("selected Power levels follow all selected keys in order including unknown and native Magic",()=>{
    const h=harness();h.model.ids=["clear","out","fraction","in","both","custom","native"];
    h.model.keyData={clear:{active:false},out:{active:true,expression:math.powerExpression(3,"out")},fraction:{active:true,expression:"t^1.539"},in:{active:true,expression:"pow(x,2)"},both:{active:true,expression:math.powerExpression(4,"in out")},custom:{active:true,expression:"x+sin(PI*x)*0.1"},native:{active:true,expression:""}};
    h.events.onKeySelectionChanged();assert.deepEqual(Array.from(h.controller.getState().selectedPowerLevels),[1,3,1.539,2,4,"?","?"]);
    h.model.ids=["both","clear","in"];h.events.onKeySelectionChanged();assert.deepEqual(Array.from(h.controller.getState().selectedPowerLevels),[4,1,2]);
    h.controller.setPower("5,763",true,"numeric");assert.deepEqual(Array.from(h.controller.getState().selectedPowerLevels),[5.763,5.763,5.763]);
    h.controller.clear();assert.deepEqual(Array.from(h.controller.getState().selectedPowerLevels),[1,1,1]);
});
test("matching fractional Power curves disable Apply for In, Both and Out",()=>{
    for(const direction of ["in","in out","out"]){
        const h=harness({"measey.preferences.v1":{power:1.539,direction}});
        h.model.expression=direction==='in'?"t^1.539":math.powerExpression(1.539,direction);h.events.onKeySelectionChanged();
        assert.deepEqual(Array.from(h.controller.getState().selectedPowerLevels),[1.539]);assert.equal(h.controller.getState().canApplyPower,false);
        const typed=h.model.expression;h.controller.editExpression(typed,false);assert.equal(h.controller.getState().powerExpression,math.powerExpression(1.539,direction));
        h.controller.applyPower();assert.equal(h.actions.length,0);assert.equal(h.controller.getState().expression,typed);
    }
});
test("Both midpoint preferences retain precision and preserve existing automatic choices",()=>{
    assert.equal(harness().controller.getState().bothMidpoint,0.5);
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true,applyOnDrag:true,bothMidpoint:0.53719}});
    assert.equal(h.controller.getState().bothMidpoint,0.53719);assert.equal(h.controller.getState().autoApply,true);assert.equal(h.controller.getState().applyOnDrag,true);
    h.controller.setBothMidpoint("0,63971",true,"numeric");assert.equal(h.actions.length,0,"Out remembers the midpoint without applying it");
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().bothMidpoint,0.63971);assert.equal(restarted.controller.getState().autoApply,true);assert.equal(restarted.controller.getState().applyOnDrag,true);
    for(const midpoint of [0,0.009,0.991,1,"0.4",null])assert.equal(harness({"measey.preferences.v1":{bothMidpoint:midpoint}}).controller.getState().bothMidpoint,0.5);
});
test("manual Both midpoint guide snaps to one percent and keeps custom text and selected overlays",()=>{
    const h=harness({"measey.preferences.v1":{power:4,direction:"in out",syncExpression:false,powerSelected:true,customExpression:"x^7"}});
    h.model.expression=math.powerExpression(4,"in out",0.5);h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,false);
    const custom="x+sin(PI*x)*0.1";h.controller.editExpression(custom,false);const grey=JSON.stringify(h.controller.getState().selectionPreviewCurves);
    h.controller.setBothMidpoint(0.273,false,"drag");assert.equal(h.controller.getState().bothMidpoint,0.27);
    assert.equal(h.controller.getState().powerExpression,math.powerExpression(4,"in out",0.27));assert.equal(h.controller.getState().canApplyPower,true);
    h.controller.setBothMidpoint(0.273,true,"drag");h.timers[0].fire();assert.equal(h.actions.length,0);
    assert.equal(JSON.stringify(h.controller.getState().selectionPreviewCurves),grey);assert.equal(h.controller.getState().expression,custom);
    h.controller.applyPower();assert.equal(h.actions.length,1);assert.equal(h.actions[0].expression,math.powerExpression(4,"in out",0.27));
    assert.equal(h.controller.getState().canApplyPower,false);assert.deepEqual(Array.from(h.controller.getState().selectedPowerLevels),[4]);
});
test("numeric Both midpoint accepts precise point and comma input but rejects malformed and out-of-range values",()=>{
    const h=harness({"measey.preferences.v1":{power:1.539,direction:"in out",syncExpression:false,powerSelected:true,customExpression:"x^7"}});
    h.controller.setBothMidpoint("0,5371",true,"numeric");assert.equal(h.controller.getState().bothMidpoint,0.5371);
    assert.equal(h.actions[0].expression,math.powerExpression(1.539,"in out",0.5371));assert.equal(h.controller.getState().canApplyPower,false);
    h.controller.setBothMidpoint("0.5371",true,"numeric");assert.equal(h.actions.length,1,"Equivalent decimal separators do not repeat application");
    for(const value of ["", " ","0.","0,","0.5.1","0,5,1","5e-1","0x0.5",0.009,0.991,Infinity,NaN,true,{},[],null]){
        h.controller.setBothMidpoint(value,true,"numeric");assert.equal(h.controller.getState().bothMidpoint,0.5371);assert.equal(h.actions.length,1);
    }
    h.controller.setBothMidpoint(".25",false,"numeric");assert.equal(h.controller.getState().bothMidpoint,0.25);assert.equal(h.actions.length,1);
    h.controller.setBothMidpoint(0.01,false,"numeric");h.controller.setBothMidpoint(0.99,false,"numeric");assert.equal(h.controller.getState().bothMidpoint,0.99);
    assert.equal(h.controller.getState().expression,"x^7");
});
test("In and Out remember the Both midpoint and use it when switching back to Both",()=>{
    const h=harness({"measey.preferences.v1":{syncExpression:false,powerSelected:true,customExpression:"x^7"}}),out=h.controller.getState().powerExpression;
    h.controller.setBothMidpoint("0.37",true,"numeric");assert.equal(h.actions.length,0);assert.equal(h.controller.getState().powerExpression,out);
    h.clickMenu("Apply on direction");h.controller.setDirection("in");assert.equal(h.actions.length,1);
    h.controller.setBothMidpoint(0.234,false,"drag");assert.equal(h.controller.getState().bothMidpoint,0.23);assert.equal(h.actions.length,1);
    assert.equal(h.controller.getState().powerExpression,math.powerExpression(4,"in"));
    h.controller.setDirection("in out");assert.equal(h.actions[1].expression,math.powerExpression(4,"in out",0.23));
    h.controller.setDirection("out");h.controller.setDirection("in out");assert.equal(h.controller.getState().bothMidpoint,0.23);
    assert.equal(h.controller.getState().expression,"x^7");
});
test("automatic midpoint guides apply the latest curve only to selected keys and cancel pending typing",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true,applyOnDrag:true,power:4,direction:"in out",syncExpression:false,powerSelected:true,customExpression:"x^7"}});
    h.model.ids=["selected"];h.model.keyData={selected:{expression:math.powerExpression(4,"in out",0.5),active:true},before:{expression:"x^2",active:true},after:{expression:"x^3",active:true}};
    const before=JSON.stringify(h.model.keyData.before),after=JSON.stringify(h.model.keyData.after);h.events.onKeySelectionChanged();
    const custom="x+sin(PI*x)*0.1";h.controller.editExpression(custom,false);assert.ok(h.timers[0].active);
    h.controller.setBothMidpoint(0.284,false,"drag");h.controller.setBothMidpoint(0.736,false,"drag");assert.equal(h.actions.length,0);assert.ok(h.timers[0].active);
    h.timers[0].fire();assert.equal(h.actions.length,1);assert.deepEqual(h.actions[0].ids,["selected"]);assert.equal(h.actions[0].expression,math.powerExpression(4,"in out",0.74));
    h.controller.setBothMidpoint(0.736,true,"drag");assert.equal(h.actions.length,1,"Release after delayed application does not duplicate the write");
    assert.equal(JSON.stringify(h.model.keyData.before),before);assert.equal(JSON.stringify(h.model.keyData.after),after);assert.equal(h.controller.getState().expression,custom);
});
test("midpoint guide timers cancel on selection or composition changes",()=>{
    for(const change of [h=>{h.model.ids=["key#2"];},h=>{h.model.comp="comp#2";}]){
        const h=harness({"measey.preferences.v1":{defaultsVersion:130,applyOnDrag:true,direction:"in out"}});
        h.controller.setBothMidpoint(0.7,false,"drag");assert.ok(h.timers[0].active);change(h);h.timers[0].fire();assert.equal(h.actions.length,0);
    }
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true,applyOnDrag:false,direction:"in out"}});
    h.controller.editExpression("x^9",false);h.controller.setBothMidpoint(0.4,false,"drag");assert.equal(h.timers[0].active,false);h.timers[0].fire();assert.equal(h.actions.length,0);
});
test("Both midpoint preset metadata survives save and import while legacy Both presets restore the center",()=>{
    const h=harness({"measey.preferences.v1":{power:2.7631,direction:"in out",bothMidpoint:0.5371,syncExpression:false,powerSelected:true,customExpression:"x^7"}});
    h.controller.setBothMidpoint("0,2731",false,"numeric");h.libraryMenu("Save Preset");
    assert.equal(h.controller.getPresets()[0].bothMidpoint,0.2731);
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().bothMidpoint,0.2731);assert.equal(restarted.controller.getPresets()[0].bothMidpoint,0.2731);
    h.importFile({name:"OLD BOTH",presets:[{name:"CENTER",power:3,type:"in out",expression:math.powerExpression(3,"in out")}]});
    const old=h.controller.getPresets()[0];assert.equal(old.bothMidpoint,0.5);h.controller.selectPreset(old.id);assert.equal(h.controller.getState().bothMidpoint,0.5);
    h.importFile({name:"OFFSET",presets:[{name:"OFFSET",power:5,type:"in out",bothMidpoint:0.317,expression:math.powerExpression(5,"in out",0.317)}]});
    h.controller.selectPreset(h.controller.getPresets()[0].id);assert.equal(h.controller.getState().bothMidpoint,0.317);assert.equal(h.controller.getState().canApplyPower,false);
    assert.equal(h.controller.getState().expression,"x^7");
    h.importFile({name:"INVALID",presets:[{name:"BAD MIDPOINT",power:5,type:"in out",bothMidpoint:0.001,expression:math.powerExpression(5,"in out")},{name:"MISMATCH",power:5,type:"in out",bothMidpoint:0.7,expression:math.powerExpression(5,"in out",0.3)}]});
    assert.equal(h.controller.getPresets()[0].power,undefined);assert.equal(h.controller.getPresets()[1].power,undefined);
});
test("Both midpoint editor delegates to the panel and committed values use the shared setter",()=>{
    const h=harness({"measey.preferences.v1":{direction:"in out",syncExpression:false,powerSelected:true,customExpression:"x^7"}});
    const writes=h.writes.length;h.controller.openMidpointEditor();assert.equal(h.writes.length,writes);assert.equal(h.actions.length,0);
    assert.deepEqual(h.midpointOpens,[0.5]);assert.equal(h.modalCalls.length,0);
    h.controller.setBothMidpoint("0,6391",true,"numeric");assert.equal(h.controller.getState().bothMidpoint,0.6391);
    assert.equal(h.actions[0].expression,math.powerExpression(4,"in out",0.6391));assert.equal(h.controller.getState().expression,"x^7");
});
test("Sync expression defaults on and generated controls never enqueue typing writes",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
    assert.equal(h.controller.getState().syncExpression,true);assert.equal(h.controller.getState().powerSelected,true);
    assert.equal(h.controller.getState().expression,math.powerExpression(4,"out"));
    h.controller.editExpression("x+sin(PI*x)*0.1",false);assert.ok(h.timers[0].active);
    h.controller.setPower(6,false,"slider");assert.equal(h.controller.getState().expression,math.powerExpression(6,"out"));assert.equal(h.timers[0].active,false);
    h.controller.editExpression(h.controller.getState().expression,true);h.events.onSceneChanged();h.controller.editExpression(h.controller.getState().expression,true);assert.equal(h.actions.length,0);
    h.clickMenu("Apply on direction");h.controller.setDirection("in out");assert.equal(h.actions.length,1);assert.equal(h.controller.getState().expression,math.powerExpression(6,"in out"));
    h.controller.setBothMidpoint("0,37",true,"numeric");assert.equal(h.actions.length,2);assert.equal(h.controller.getState().expression,math.powerExpression(6,"in out",0.37));
    h.controller.editExpression(h.controller.getState().expression,true);h.timers[0].fire();assert.equal(h.actions.length,2);
    h.controller.clear();assert.equal(h.controller.getState().expression,"x");assert.equal(h.actions.at(-1).type,"clear");
    const count=h.actions.length;h.controller.editExpression("x",true);assert.equal(h.actions.length,count);assert.equal(h.model.colorId,16);
});
test("Sync expression off preserves separate text and selected controls across reopening",()=>{
    const custom="x+sin(PI*x)*0.1",h=harness({"measey.preferences.v1":{syncExpression:false,powerSelected:false,customExpression:custom,power:4,direction:"out"}});
    assert.equal(h.controller.getState().powerSelected,false);h.controller.setPower(5,false,"slider");
    assert.equal(h.controller.getState().expression,custom);assert.equal(h.controller.getState().powerSelected,true);
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().powerSelected,true);assert.equal(restarted.controller.getState().expression,custom);assert.equal(restarted.controller.getState().powerExpression,math.powerExpression(5,"out"));
    restarted.clickMenu("Sync expression");assert.equal(restarted.controller.getState().syncExpression,true);assert.equal(restarted.controller.getState().expression,math.powerExpression(5,"out"));assert.equal(restarted.actions.length,0);
    restarted.controller.editExpression(custom,false);assert.equal(restarted.controller.getState().powerSelected,false);
    restarted.clickMenu("Sync expression");restarted.clickMenu("Sync expression");assert.equal(restarted.controller.getState().expression,custom);assert.equal(restarted.controller.getState().powerSelected,false);
    assert.equal(harness(restarted.prefs).controller.getState().syncExpression,true);
});
test("typing recognizes Power direction and midpoint while preserving exact typed source with either sync setting",()=>{
    for(const syncExpression of [true,false]){
        const h=harness({"measey.preferences.v1":{syncExpression}}),typed="t ^ 1.539";
        h.controller.editExpression(typed,false);assert.equal(h.controller.getState().expression,typed);assert.equal(h.controller.getState().powerSelected,true);
        assert.equal(h.controller.getState().power,1.539);assert.equal(h.controller.getState().direction,"in");
        const both=math.powerExpression(4.763,"in out",0.3271);h.controller.editExpression(both,false);
        assert.equal(h.controller.getState().power,4.763);assert.equal(h.controller.getState().direction,"in out");assert.equal(h.controller.getState().bothMidpoint,0.3271);assert.equal(h.controller.getState().expression,both);
        h.controller.editExpression("1-(1-x)^8.25",false);assert.equal(h.controller.getState().power,8.25);assert.equal(h.controller.getState().direction,"out");assert.equal(h.controller.getState().bothMidpoint,0.3271);
        assert.equal(h.actions.length,0);assert.equal(h.prefs["measey.preferences.v1"].customExpression,"1-(1-x)^8.25");
    }
});
test("unrecognized custom formulas drive preview and Power Apply while invalid text disables it",()=>{
    const h=harness(),custom="x+sin(PI*x)*0.1",canonical=math.compile(custom).expression;
    h.controller.editExpression(custom,false);assert.equal(h.controller.getState().powerSelected,false);assert.equal(h.controller.getState().powerExpression,canonical);assert.equal(h.controller.getState().activeExpression,canonical);
    assert.equal(h.controller.getState().power,4);assert.equal(h.controller.getState().direction,"out");assert.equal(h.controller.getState().canApplyPower,true);
    h.controller.applyPower();assert.equal(h.actions[0].expression,canonical);assert.equal(h.controller.getState().canApplyPower,false);
    h.model.ids=["key#2"];h.model.expression="x^3";h.model.keyData={};h.events.onKeySelectionChanged();
    assert.equal(h.controller.getState().powerSelected,false);assert.equal(h.controller.getState().powerExpression,canonical);h.controller.applyPower();assert.equal(h.actions[1].expression,canonical);
    for(const text of ["api.delete()",""]){h.controller.editExpression(text,false);assert.equal(h.controller.getState().powerSelected,false);assert.equal(h.controller.getState().powerExpression,"");assert.equal(h.controller.getState().canApplyPower,false);h.controller.applyPower();}
    assert.equal(h.actions.length,2);h.clickMenu("Apply on direction");h.controller.setDirection("in");assert.equal(h.controller.getState().powerSelected,true);assert.equal(h.actions[2].expression,math.powerExpression(4,"in"));
});
test("explicit Get recognizes selected formulas and leaves mixed or native easing unselected",()=>{
    const custom="x+sin(PI*x)*0.1",h=harness({"measey.preferences.v1":{customExpression:custom,powerSelected:false}}),formula=math.powerExpression(2.763,"in out",0.4179);
    h.model.expression=formula;h.events.onKeySelectionChanged();assert.equal(h.controller.getState().expression,custom);assert.equal(h.controller.getState().powerSelected,false);
    h.controller.getSelection();assert.equal(h.controller.getState().expression,formula);assert.equal(h.controller.getState().powerSelected,true);assert.equal(h.controller.getState().power,2.763);assert.equal(h.controller.getState().direction,"in out");assert.equal(h.controller.getState().bothMidpoint,0.4179);
    h.model.expression="";h.model.nativeMagic=true;h.controller.getSelection();assert.equal(h.controller.getState().powerSelected,false);assert.equal(h.controller.getState().powerExpression,"");
    h.model.nativeMagic=false;h.model.mixed=true;h.model.expression="x^2";h.controller.getSelection();assert.equal(h.controller.getState().powerSelected,false);assert.equal(h.controller.getState().expression,"");
    h.model.mixed=false;h.model.expression=custom;h.controller.getSelection();assert.equal(h.controller.getState().powerSelected,false);assert.equal(h.controller.getState().powerExpression,math.compile(custom).expression);
    assert.equal(h.controller.getState().power,2.763);assert.equal(h.controller.getState().bothMidpoint,0.4179);assert.equal(h.actions.length,0);
});
test("custom and Power presets update recognition and saving uses the current custom formula",()=>{
    const custom="x+sin(PI*x)*0.1",h=harness({"measey.preferences.v1":{syncExpression:false,powerSelected:true,customExpression:"x^7"}});
    h.importFile({name:"USER",presets:[{name:"POWER",expression:"x^2"},{name:"CUSTOM",expression:custom}]});
    h.controller.selectPreset(h.controller.getPresets()[0].id);assert.equal(h.controller.getState().powerSelected,true);assert.equal(h.controller.getState().power,2);assert.equal(h.controller.getState().direction,"in");assert.equal(h.controller.getState().expression,"x^7");
    h.controller.selectPreset(h.controller.getPresets()[1].id);assert.equal(h.controller.getState().powerSelected,false);assert.equal(h.controller.getState().expression,math.compile(custom).expression);assert.equal(h.controller.getState().canApplyPower,false);
    h.libraryMenu("Save Preset");const saved=h.controller.getPresets().at(-1);assert.equal(saved.expression,math.compile(custom).expression);assert.equal(saved.power,undefined);
});
test("Flatten retains its source formula while Clear synchronizes only when enabled",()=>{
    for(const syncExpression of [true,false]){
        const h=harness({"measey.preferences.v1":{syncExpression}}),formula=math.powerExpression(3,"in out",0.37);
        h.controller.editExpression(formula,false);h.controller.applyPower();h.controller.flatten();
        assert.equal(h.controller.getState().expression,formula);assert.equal(h.controller.getState().powerSelected,true);assert.equal(h.controller.getState().power,3);assert.equal(h.controller.getState().bothMidpoint,0.37);assert.equal(h.controller.getState().canApplyPower,true);
        assert.equal(h.controller.getState().selectionPreviewCurves[0].flattened,true);
        h.controller.clear();assert.equal(h.controller.getState().expression,syncExpression?"x":formula);assert.equal(h.controller.getState().power,1);assert.equal(h.controller.getState().canApplyPower,false);
    }
});
test("startup recognizes legacy saved expressions without discarding remembered custom-mode preferences",()=>{
    const custom="x+sin(PI*x)*0.1",legacy=harness({"measey.preferences.v1":{power:5,direction:"out",bothMidpoint:0.37,customExpression:custom}});
    assert.equal(legacy.controller.getState().powerSelected,false);assert.equal(legacy.controller.getState().power,5);assert.equal(legacy.controller.getState().direction,"out");assert.equal(legacy.controller.getState().bothMidpoint,0.37);
    const matched=harness({"measey.preferences.v1":{customExpression:"t^2.763"}});assert.equal(matched.controller.getState().powerSelected,true);assert.equal(matched.controller.getState().power,2.763);assert.equal(matched.controller.getState().direction,"in");assert.equal(matched.controller.getState().expression,"t^2.763");
    legacy.controller.setDirection("in out");assert.equal(legacy.controller.getState().powerSelected,true);assert.equal(legacy.controller.getState().power,5);assert.equal(legacy.controller.getState().expression,math.powerExpression(5,"in out",0.37));
});
test("a synced expression commit applies to a new selection instead of being treated as an old field update",()=>{
    for(const notify of [true,false]){
        const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true}});
        h.controller.setPower(6,false,"slider");const synced=h.controller.getState().expression;assert.equal(h.actions.length,0);
        h.model.ids=["key#2"];if(notify)h.events.onKeySelectionChanged();
        h.controller.editExpression(synced,true);assert.equal(h.actions.length,1);assert.deepEqual(h.actions[0].ids,["key#2"]);
        assert.equal(h.actions[0].expression,math.compile(synced).expression);
    }
});

test("endpoint preferences default to flat and preserve validated values across restarting",()=>{
    const h=harness();assert.equal(h.controller.getState().bottom,0);assert.equal(h.controller.getState().top,0);
    h.controller.setEndpoint("top",0.317,false,"numeric");h.controller.setEndpoint("bottom",0.563,false,"numeric");
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().bottom,0.563);assert.equal(restarted.controller.getState().top,0.317);
    assert.equal(restarted.controller.getState().powerExpression,math.powerExpression(4,"out",0.5,0.563,0.317));
    for(const bad of [-1,1.01,".4",null]){const invalid=harness({"measey.preferences.v1":{bottom:bad,top:bad}});assert.equal(invalid.controller.getState().bottom,0);assert.equal(invalid.controller.getState().top,0);}
});
test("endpoint drag previews in hundredths and manual Apply avoids duplicate writes",()=>{
    const h=harness({"measey.preferences.v1":{direction:"in out",bothMidpoint:.37}});
    h.controller.setEndpoint("bottom",.375,false,"drag");h.controller.setEndpoint("top",.623,true,"drag");
    assert.equal(h.controller.getState().bottom,.38);assert.equal(h.controller.getState().top,.62);assert.equal(h.actions.length,0);
    const formula=math.powerExpression(4,"in out",.37,.38,.62);assert.equal(h.controller.getState().expression,formula);assert.equal(h.controller.getState().powerExpression,formula);
    h.controller.applyPower();assert.equal(h.actions[0].expression,formula);assert.equal(h.controller.getState().canApplyPower,false);
    h.controller.applyPower();assert.equal(h.actions.length,1);
});
test("automatic endpoint dragging respects its toggle and cancels stale selections",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,applyOnDrag:true}});
    h.controller.setEndpoint("top",.4,false,"drag");assert.equal(h.actions.length,0);assert.ok(h.timers[0].active);
    h.timers[0].fire();assert.equal(h.actions.length,1);assert.equal(h.actions[0].expression,math.powerExpression(4,"out",.5,0,.4));
    h.controller.setEndpoint("top",.6,false,"drag");h.model.ids=["key#2"];h.timers[0].fire();assert.equal(h.actions.length,1);
    h.controller.setEndpoint("top",.7,false,"drag");h.clickMenu("Apply on drag");assert.equal(h.timers[0].active,false);h.timers[0].fire();assert.equal(h.actions.length,1);
});
test("endpoint numeric commits accept precise comma decimals and apply once",()=>{
    const h=harness({"measey.preferences.v1":{direction:"in"}});
    h.controller.setEndpoint("bottom","0,3757",true,"numeric");assert.equal(h.controller.getState().bottom,.3757);assert.equal(h.actions.length,1);
    assert.equal(h.actions[0].expression,math.powerExpression(4,"in",.5,.3757,0));
    h.controller.setEndpoint("bottom",.3757,true,"numeric");assert.equal(h.actions.length,1);
});
test("invalid endpoint edits cannot mutate keys or overwrite remembered controls",()=>{
    const h=harness();h.controller.setEndpoint("top",.4,false,"numeric");
    for(const bad of [-.01,1.01,Infinity,NaN,"abc","0,4.5",""])h.controller.setEndpoint("top",bad,true,"numeric");
    h.controller.setEndpoint("other",.7,true,"numeric");assert.equal(h.actions.length,0);assert.equal(h.controller.getState().top,.4);assert.equal(h.controller.getState().bottom,0);
});
test("inactive endpoint settings are remembered without triggering a host write",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,applyOnDrag:true,direction:"out"}});
    h.controller.setEndpoint("bottom",.6,true,"numeric");assert.equal(h.actions.length,0);assert.equal(h.timers[0].active,false);assert.equal(h.controller.getState().bottom,.6);
    h.controller.setDirection("in");assert.equal(h.actions.length,0);h.controller.applyPower();assert.equal(h.actions[0].expression,math.powerExpression(4,"in",.5,.6,0));
});
test("endpoint changes synchronize without creating typing writes or replacing separate custom text",()=>{
    for(const syncExpression of [true,false]){
        const h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true,syncExpression,powerSelected:true,customExpression:"sin(PI*x/2)"}});
        const original=h.controller.getState().expression;h.controller.setEndpoint("top",.32,false,"drag");
        assert.equal(h.controller.getState().expression,syncExpression?math.powerExpression(4,"out",.5,0,.32):original);assert.equal(h.timers[0].active,false);assert.equal(h.actions.length,0);
        if(syncExpression)h.controller.editExpression(h.controller.getState().expression,true);
        h.timers[0].fire();assert.equal(h.actions.length,0);
    }
});
test("typing and Get restore endpoint settings while legacy curves reset active endpoints",()=>{
    const h=harness({"measey.preferences.v1":{bottom:.3,top:.4,powerSelected:true}});
    const formula=math.powerExpression(6.25,"in out",.317,.239,.583);h.controller.editExpression(formula,false);
    assert.equal(h.controller.getState().powerSelected,true);assert.equal(h.controller.getState().power,6.25);assert.equal(h.controller.getState().bothMidpoint,.317);assert.equal(h.controller.getState().bottom,.239);assert.equal(h.controller.getState().top,.583);assert.equal(h.controller.getState().expression,formula);
    h.model.expression=math.powerExpression(5,"out",.5,0,.627);h.controller.getSelection();assert.equal(h.controller.getState().top,.627);assert.equal(h.controller.getState().bottom,.239);
    h.controller.editExpression("x^3",false);assert.equal(h.controller.getState().bottom,0);assert.equal(h.controller.getState().top,.627);
    h.controller.editExpression(math.powerExpression(4,"in out"),false);assert.equal(h.controller.getState().bottom,0);assert.equal(h.controller.getState().top,0);assert.equal(h.actions.length,0);
});
test("saved endpoint presets round trip and invalid metadata becomes an ordinary expression",()=>{
    const h=harness({"measey.preferences.v1":{direction:"in out",bothMidpoint:.37,bottom:.2,top:.6}});
    h.libraryMenu("Save Preset");const saved=h.controller.getPresets()[0];assert.equal(saved.bottom,.2);assert.equal(saved.top,.6);assert.equal(saved.bothMidpoint,.37);
    const restarted=harness(h.prefs);restarted.controller.selectPreset(restarted.controller.getPresets()[0].id);assert.equal(restarted.controller.getState().bottom,.2);assert.equal(restarted.controller.getState().top,.6);assert.equal(restarted.actions[0].expression,saved.expression);
    h.importFile({name:"BAD META",presets:[{name:"WRONG",power:4,type:"in out",bottom:.7,top:.6,bothMidpoint:.37,expression:saved.expression},{name:"INVALID",power:4,type:"in out",bottom:2,top:.6,bothMidpoint:.37,expression:saved.expression}]});
    assert.equal(h.controller.getPresets()[0].power,undefined);assert.equal(h.controller.getPresets()[1].power,undefined);
});
test("Power1 keeps clearing semantics with endpoint adjustments and close cancels endpoint writes",()=>{
    const h=harness({"measey.preferences.v1":{power:1,bottom:.8,top:.6}});h.model.expression="x^4";h.events.onKeySelectionChanged();
    h.controller.setEndpoint("top",.7,true,"numeric");assert.equal(h.actions[0].type,"clear");assert.equal(h.model.colorId,16);assert.equal(h.controller.getState().expression,"x");
    h.controller.setPower(4,false,"slider");h.clickMenu("Apply on drag");h.controller.setEndpoint("top",.8,false,"drag");assert.ok(h.timers[0].active);
    h.ui.onClose();const writes=h.writes.length;h.timers[0].fire();h.controller.setEndpoint("top",0,true,"numeric");assert.equal(h.actions.length,1);assert.equal(h.writes.length,writes);
});

test("direction clicks preview by default and their option applies and persists when enabled",()=>{
    const h=harness();assert.equal(h.controller.getState().applyOnDirection,false);
    for(const direction of ["in","in out","out"]){h.controller.setDirection(direction);assert.equal(h.controller.getState().direction,direction);assert.equal(h.actions.length,0);assert.equal(h.timers[0].active,false);assert.equal(h.controller.getState().expression,math.powerExpression(4,direction));}
    h.clickMenu("Apply on direction");h.controller.setDirection("in");assert.equal(h.actions.length,1);assert.equal(h.actions[0].expression,math.powerExpression(4,"in"));
    assert.equal(harness(h.prefs).controller.getState().applyOnDirection,true);h.clickMenu("Apply on direction");h.controller.setDirection("in out");assert.equal(h.actions.length,1);assert.equal(harness(h.prefs).controller.getState().applyOnDirection,false);
});
test("direction application is independent of drag and typing options and cancels pending writes",()=>{
    const h=harness({"measey.preferences.v1":{defaultsVersion:130,applyOnDrag:true,autoApply:true}});
    h.controller.setPower(6,false,"slider");assert.ok(h.timers[0].active);h.controller.setDirection("in");assert.equal(h.timers[0].active,false);h.timers[0].fire();assert.equal(h.actions.length,0);
    h.controller.editExpression("x+sin(PI*x)*0.1",false);assert.ok(h.timers[0].active);h.controller.setDirection("in out");assert.equal(h.timers[0].active,false);h.timers[0].fire();assert.equal(h.actions.length,0);
    h.clickMenu("Apply on direction");h.controller.setDirection("out");assert.equal(h.actions.length,1);assert.equal(h.controller.getState().autoApply,true);assert.equal(h.controller.getState().applyOnDrag,true);
});
test("manual direction clicks at Power1 leave selected keys unchanged until Apply",()=>{
    const h=harness({"measey.preferences.v1":{power:1}});h.model.expression="x^4";h.events.onKeySelectionChanged();h.controller.setDirection("in out");
    assert.equal(h.actions.length,0);assert.equal(h.model.expression,"x^4");assert.equal(h.controller.getState().canApplyPower,true);h.controller.applyPower();assert.equal(h.actions[0].type,"clear");
});

test("matching checks both short endpoint branches instead of treating their curved span as linear",()=>{
    for(const [midpoint,bottom,top] of [[.01,0,1],[.99,1,0]]){
        const h=harness({"measey.preferences.v1":{power:4,direction:"in out",bothMidpoint:midpoint,bottom,top,powerSelected:true}});
        h.model.expression="x";h.model.magicActive=true;h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,true);
        const formula=math.powerExpression(4,"in out",midpoint,bottom,top);h.controller.applyPower();assert.equal(h.actions.length,1);assert.equal(h.actions[0].expression,formula);assert.equal(h.controller.getState().canApplyPower,false);
        h.importFile({name:"SHORT",presets:[{name:"BAD",power:4,type:"in out",bothMidpoint:midpoint,bottom,top,expression:"x"}]});assert.equal(h.controller.getPresets()[0].power,undefined);
    }
});

test("weight editors open only for currently visible Power handles without mutating keys",()=>{
    const h=harness();for(const kind of ["top","bottom","midpoint","unknown"])h.controller.openWeightEditor(kind);
    assert.deepEqual(h.weightOpens,["top"]);assert.equal(h.actions.length,0);
    h.controller.setDirection("in");h.controller.openWeightEditor("bottom");h.controller.openWeightEditor("top");h.controller.openWeightEditor("midpoint");assert.deepEqual(h.weightOpens,["top","bottom"]);
    h.controller.setDirection("in out");for(const kind of ["top","bottom","midpoint"])h.controller.openWeightEditor(kind);assert.deepEqual(h.weightOpens,["top","bottom","top","bottom","midpoint"]);
    h.controller.editExpression("sin(PI*x/2)",false);h.controller.openWeightEditor("top");h.controller.openMidpointEditor();assert.equal(h.weightOpens.length,5);assert.equal(h.actions.length,0);
});
test("Reset Weights restores all handles and applies a single baseline curve",()=>{
    const h=harness({"measey.preferences.v1":{direction:"in out",power:6,bothMidpoint:.37,bottom:.2,top:.6}});
    h.model.expression=math.powerExpression(6,"in out",.37,.2,.6);h.events.onKeySelectionChanged();h.controller.resetWeights();
    assert.equal(h.controller.getState().bottom,0);assert.equal(h.controller.getState().top,0);assert.equal(h.controller.getState().bothMidpoint,.5);assert.equal(h.controller.getState().power,6);assert.equal(h.controller.getState().direction,"in out");
    assert.equal(h.actions.length,1);assert.equal(h.actions[0].expression,math.powerExpression(6,"in out"));assert.equal(h.controller.getState().expression,math.powerExpression(6,"in out"));
    h.controller.resetWeights();assert.equal(h.actions.length,1);const restarted=harness(h.prefs);assert.equal(restarted.controller.getState().bottom,0);assert.equal(restarted.controller.getState().top,0);assert.equal(restarted.controller.getState().bothMidpoint,.5);
});
test("Reset Weights cancels pending drafts and preserves separate text when sync is off",()=>{
    const custom="x+sin(PI*x)*.1",h=harness({"measey.preferences.v1":{defaultsVersion:130,autoApply:true,applyOnDrag:true,syncExpression:false,direction:"in out",power:4,bothMidpoint:.63,bottom:.7,top:.3}});
    h.controller.editExpression(custom,false);assert.ok(h.timers[0].active);h.controller.resetWeights();assert.equal(h.timers[0].active,false);h.timers[0].fire();assert.equal(h.actions.length,1);assert.equal(h.controller.getState().expression,custom);assert.equal(h.controller.getState().powerSelected,true);
    assert.equal(h.actions[0].expression,math.powerExpression(4,"in out"));assert.equal(h.controller.getState().applyOnDirection,false);
});
test("Reset Weights handles no selection and close without unintended writes",()=>{
    const h=harness({"measey.preferences.v1":{direction:"in out",power:1,bothMidpoint:.7,bottom:.8,top:.9}});
    h.model.ids=[];h.events.onKeySelectionChanged();h.controller.resetWeights();assert.equal(h.actions.length,0);assert.equal(h.controller.getState().bottom,0);assert.equal(h.controller.getState().top,0);assert.equal(h.controller.getState().bothMidpoint,.5);
    h.ui.onClose();const writes=h.writes.length;h.controller.resetWeights();h.controller.openWeightEditor("midpoint");assert.equal(h.writes.length,writes);assert.equal(h.weightOpens.length,0);
});

test("selected graph previews stop at ten while full Power labels and actions remain intact",()=>{
    const h=harness({"measey.preferences.v1":{power:4,direction:"in"}});
    h.model.ids=Array.from({length:1000},(_,i)=>"key#"+(i+1));h.model.expression="x^4";
    h.model.previewCurves=h.model.ids.map((id,i)=>({keyId:id,expression:"x^"+(i+2)}));
    h.model.keyData={"key#1000":{expression:"x^7",active:true,colorId:11}};
    h.events.onKeySelectionChanged();let s=h.controller.getState();
    assert.equal(h.model.readOptions.previewLimit,10);assert.equal(h.model.readOptions.samples,false);
    assert.equal(s.selectionPreviewCurves.length,10);assert.equal(s.previewCurves.length,10);
    assert.deepEqual(Array.from(s.selectionPreviewCurves,c=>c.keyId),h.model.ids.slice(0,10));assert.equal(s.selectionPreviewLimited,true);
    assert.equal(s.selectedPowerLevels.length,1000);assert.equal(s.selectedPowerLevels[999],7);
    assert.equal(s.canApplyPower,true,"A mismatch beyond the graph budget must still require Apply");
    h.controller.applyPower();assert.equal(h.actions.at(-1).type,"apply");assert.equal(h.actions.at(-1).ids.length,1000);
    assert.equal(h.controller.getState().canApplyPower,false);
    h.controller.flatten();assert.equal(h.actions.at(-1).type,"flatten");assert.equal(h.actions.at(-1).ids.length,1000);
    h.controller.clear();assert.equal(h.actions.at(-1).type,"clear");assert.equal(h.actions.at(-1).ids.length,1000);
    h.model.ids=h.model.ids.slice(0,10);h.events.onKeySelectionChanged();assert.equal(h.controller.getState().selectionPreviewLimited,false);
    h.model.ids=[];h.events.onKeySelectionChanged();assert.equal(h.controller.getState().selectionPreviewCurves.length,0);assert.equal(h.controller.getState().selectionPreviewLimited,false);
});
test("preview budget counts keys rather than distinct formulas and Get still reads the full mixed selection",()=>{
    const h=harness();h.model.ids=Array.from({length:11},(_,i)=>"key#"+(i+1));h.model.expression="x^4";
    h.model.previewCurves=h.model.ids.map((id,i)=>({keyId:id,expression:i<10?"x^4":"x^7"}));
    h.model.mixed=true;h.model.keyData={"key#11":{expression:"x^7",active:true}};
    h.events.onKeySelectionChanged();const s=h.controller.getState();
    assert.equal(s.selectionPreviewCurves.length,10);assert.ok(s.selectionPreviewCurves.every(c=>c.expression==="x^4"));
    assert.equal(s.selectedPowerLevels[10],7);assert.equal(s.mixed,true);
    h.controller.getSelection();assert.equal(h.controller.getState().expression,"");assert.equal(h.controller.getState().powerSelected,false);
    assert.equal(h.controller.getState().selectionPreviewCurves.length,10);assert.equal(h.actions.length,0);
});
test("large repeated selections recognize each formula once and reuse Apply comparisons on redraw",()=>{
    const counts={compile:0,detect:0,generate:0};
    const measured=Object.assign({},math,{
        compile:source=>{counts.compile++;return math.compile(source);},
        detectPower:source=>{counts.detect++;return math.detectPower(source);},
        powerExpression:(...args)=>{counts.generate++;return math.powerExpression(...args);}
    });
    const h=harness({"measey.preferences.v1":{power:4,direction:"in"}},measured);
    h.model.ids=Array.from({length:5000},(_,i)=>"key#"+(i+1));h.model.expression="x^4";
    Object.keys(counts).forEach(key=>counts[key]=0);h.events.onKeySelectionChanged();
    assert.equal(counts.detect,1);assert.equal(h.controller.getState().canApplyPower,false);
    assert.equal(h.controller.getState().selectedPowerLevels.length,5000);
    assert.ok(h.controller.getState().selectedPowerLevels.every(power=>power===4));
    assert.ok(counts.compile<=2,"Equivalent source texts should compile once each, not per key");
    const after=Object.assign({},counts);for(let i=0;i<200;i++)assert.equal(h.controller.getState().canApplyPower,false);
    assert.deepEqual(counts,after,"Hover/redraw state reads must not parse, recognize, or regenerate curves");
    h.events.onKeySelectionChanged();assert.deepEqual(counts,after,"Rereading unchanged source text should reuse pure expression work");
});
test("unknown custom recognition is cached but changed source and fresh key data invalidate matching",()=>{
    let detections=0;const measured=Object.assign({},math,{detectPower:source=>{detections++;return math.detectPower(source);}});
    const h=harness({},measured);h.model.ids=Array.from({length:1000},(_,i)=>"key#"+(i+1));
    h.model.expression="sin(PI*x/2)";h.events.onKeySelectionChanged();assert.equal(detections,1);
    assert.ok(h.controller.getState().selectedPowerLevels.every(power=>power==="?"));
    h.events.onSceneChanged();assert.equal(detections,1,"Null recognition results must be cached too");
    h.model.expression=math.powerExpression(4,"out");h.events.onKeySelectionChanged();assert.equal(detections,2);assert.equal(h.controller.getState().canApplyPower,false);
    h.model.keyData={"key#1000":{expression:"x^8",active:true}};
    // The selection IDs stay identical, and no refresh callback has fired.
    h.controller.applyPower();assert.equal(h.actions.length,1,"Apply must reread key data before trusting a cached match");
    assert.equal(h.actions[0].ids.length,1000);assert.equal(h.controller.getState().canApplyPower,false);
    h.model.colorId=11;h.model.expression="x";h.model.magicActive=false;h.model.keyData={};
    h.controller.savePreferences({power:1});h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,true);
    h.controller.applyPower();assert.equal(h.actions[1].type,"clear");assert.equal(h.controller.getState().canApplyPower,false);
});
test("preference changes invalidate the requested curve and selection layer indexes stay current",()=>{
    const h=harness({"measey.preferences.v1":{power:4,direction:"in out"}});
    h.model.expression=math.powerExpression(4,"in out");h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,false);
    h.controller.savePreferences({bothMidpoint:.37});assert.equal(h.controller.getState().canApplyPower,true);
    h.controller.savePreferences({bothMidpoint:.5,bottom:.4});assert.equal(h.controller.getState().canApplyPower,true);
    h.controller.savePreferences({bottom:0});assert.equal(h.controller.getState().canApplyPower,false);
    h.events.onAttrChanged("other#1","position.x");assert.equal(h.timers[1].active,false);
    h.events.onAttrChanged("shape#1","position.x");assert.equal(h.timers[1].active,true);h.timers[1].fire();
    h.model.ids=[];h.events.onKeySelectionChanged();h.events.onAttrChanged("shape#1","position.x");assert.equal(h.timers[1].active,false);
});

test("typed Power exceeds the slider soft maximum and persists precise point or comma decimals",()=>{
    const h=harness();
    for(const [text,power] of [["12.0001",12.0001],["20,539",20.539],["100",100]]){
        h.controller.setPower(text,true,"numeric");assert.equal(h.controller.getState().power,power);
        assert.equal(h.actions.at(-1).expression,math.powerExpression(power,"out"));
        assert.equal(h.controller.getState().canApplyPower,false);assert.equal(h.controller.getState().maxPower,12);
        assert.equal(harness(h.prefs).controller.getState().power,power);
        h.controller.getSelection();assert.equal(h.controller.getState().power,power);assert.equal(h.controller.getState().powerSelected,true);
    }
    h.libraryMenu("Save Preset");assert.equal(h.controller.getPresets()[0].power,100);
    const restarted=harness(h.prefs);assert.equal(restarted.controller.getPresets()[0].power,100);
    const writes=h.actions.length;h.controller.setPower(99.539,false,"slider");assert.equal(h.controller.getState().power,12);assert.equal(h.actions.length,writes);
    h.controller.setPower(3.539,false,"slider");assert.equal(h.controller.getState().power,4);
    h.controller.setPower("3,539",true,"numeric");assert.equal(h.controller.getState().power,3.539);
});
test("matching easing with a wrong key color still needs Apply and repairs every selected key",()=>{
    const h=harness({"measey.preferences.v1":{power:4,direction:"out"}});
    h.model.ids=["key#1","key#2","key#3"];h.model.expression=math.powerExpression(4,"out");h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,false);
    h.model.keyData={"key#2":{colorId:16,active:true,expression:h.model.expression}};h.events.onKeySelectionChanged();assert.equal(h.controller.getState().canApplyPower,true);
    h.controller.applyPower();assert.equal(h.actions.length,1);assert.equal(h.actions[0].ids.length,3);assert.ok(h.model.ids.every(id=>h.model.keyData[id].colorId===11));assert.equal(h.controller.getState().canApplyPower,false);
    h.controller.applyPower();assert.equal(h.actions.length,1,"Matching Plum keys remain a no-op");
    h.model.expression="x";h.model.magicActive=false;h.model.colorId=11;h.model.keyData={};h.events.onKeySelectionChanged();h.controller.clear();
    assert.equal(h.actions[1].type,"clear");assert.ok(h.model.ids.every(id=>h.model.keyData[id].colorId===16));
});

let failed=0;
for(const {name,fn} of tests){try{fn();process.stdout.write("PASS "+name+"\n");}catch(error){failed++;process.stderr.write("FAIL "+name+"\n"+error.stack+"\n");}}
if(failed)process.exitCode=1;else process.stdout.write(tests.length+" controller test groups passed.\n");
