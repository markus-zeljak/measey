const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const math = require('../src/curve-math.js');
const hostSource = fs.readFileSync(__dirname+'/../src/measey-host.js','utf8');
function loadHost(api, mathApi = math) {
  const sandbox={api,MeaseyMath:mathApi};vm.createContext(sandbox);vm.runInContext(hostSource,sandbox);
  return sandbox.MeaseyHost;
}
function fixture() {
  let frame = 9, selection = {'basicShape#1.scale.x':[0,20]}, selected=['keyframe#1','keyframe#2'];
  const keys = {
    'keyframe#1':{frame:0, data:{numValue:0,interpolation:0,easing:34,exprEasing:'pow(x,3)',leftBez:{x:-2,y:-1}}},
    'keyframe#2':{frame:20,data:{numValue:100,interpolation:0,rightBez:{x:2,y:1}}},
    'keyframe#3':{frame:40,data:{numValue:200}},
    'keyframe#4':{frame:0,data:{numValue:1,easing:34,exprEasing:'1-pow(1-x,4)'}},
    'keyframe#5':{frame:20,data:{numValue:4}}
  };
  const attrs={'scale.x':['keyframe#1','keyframe#2','keyframe#3'], 'scale.y':['keyframe#4','keyframe#5']};
  const writes=[];
  const api={
    getSelectedKeyframes:()=>selection, getSelectedKeyframeIds:()=>selected,
    getKeyframeTimes:(l,a)=>(attrs[a]||[]).map(id=>keys[id].frame),
    getKeyframeIdsForAttribute:(l,a)=>attrs[a]||[],
    get:(id,a)=>a==='data'?keys[id].data:(a==='frame'?keys[id].frame:0),
    getActiveComp:()=> 'composition#1', layerExists:()=>true, getFrame:()=>frame,setFrame:v=>{frame=v;},
    magicEasing:(l,a,f,n,exp)=>{const id=attrs[a].find(id=>keys[id].frame===f);keys[id].data.easing=n==='None'?0:34;keys[id].data.exprEasing=exp||'';writes.push(['magic',id,n]);},
    set:(id,obj)=>{keys[id].data=JSON.parse(JSON.stringify(obj.data));writes.push(['data',id]);},
    modifyKeyframe:(l,obj)=>{for(const a of Object.keys(obj)){let d=obj[a],id=attrs[a].find(id=>keys[id].frame===d.frame);keys[id].data.interpolation=d.type;}},
    modifyKeyframeTangent:(l,obj)=>{for(const a of Object.keys(obj)){let d=obj[a],id=attrs[a].find(id=>keys[id].frame===d.frame);keys[id].data[d.outHandle?'rightBez':'leftBez']={x:d.xValue-d.frame,y:d.yValue-keys[id].data.numValue};}},
    clearKeyframeVelocity:()=>{}, setKeyframeVelocity:()=>{}
  };
  return {host:loadHost(api),api,keys,writes,setSelection:(a,ids)=>{selection=a;selected=ids;},frame:()=>frame};
}
function largeFixture(count, options = {}) {
  let frame = 9;
  const keys={}, attrs={}, times={}, frameIds={}, selected=[], selection={};
  const calls={times:0,ids:0,data:0,magicRead:0,sampleRead:0,setFrame:0,magicWrite:0,dataWrite:0,flush:0};
  const reads={};
  const channels=options.channels||(options.paired?['position.x','position.y']:['scale.x']);
  for(const attr of channels) {
    attrs[attr]=[];times[attr]=[];frameIds[attr]={};selection['basicShape#1.'+attr]=[];
    for(let i=0;i<=count;i++) {
      const id='keyframe#'+attr+':'+i;
      const data={numValue:i*100,interpolation:0,easing:i<count?34:0,exprEasing:i<count?'pow(x,3)':''};
      if(options.bezier){data.easing=0;data.exprEasing='';data.leftBez={x:-6,y:-10};data.rightBez={x:2,y:50};}
      keys[id]={frame:i*10,data};attrs[attr].push(id);times[attr].push(i*10);frameIds[attr][i*10]=id;
      if(i<count||options.selectTerminal){selected.push(id);selection['basicShape#1.'+attr].push(i*10);}
    }
  }
  const api={
    getSelectedKeyframes:()=>selection,getSelectedKeyframeIds:()=>selected,
    getKeyframeTimes:(l,a)=>{calls.times++;return times[a]||[];},
    getKeyframeIdsForAttribute:(l,a)=>{calls.ids++;return attrs[a]||[];},
    get:(id,a)=>{if(a==='data'){calls.data++;reads[id]=(reads[id]||0)+1;return keys[id].data;}calls.sampleRead++;return frame*10;},
    getActiveComp:()=> 'composition#1',layerExists:()=>true,getFrame:()=>frame,
    setFrame:v=>{frame=v;calls.setFrame++;},
    magicEasing:(l,a,f,n,exp)=>{const d=keys[frameIds[a][f]].data;d.easing=n==='None'?0:34;d.exprEasing=exp||'';calls.magicWrite++;},
    set:(id,obj)=>{keys[id].data=JSON.parse(JSON.stringify(obj.data));calls.dataWrite++;},
    modifyKeyframe:(l,obj)=>{for(const a of Object.keys(obj)){const d=obj[a];keys[frameIds[a][d.frame]].data.interpolation=d.type;}},
    modifyKeyframeTangent:(l,obj)=>{for(const a of Object.keys(obj)){const d=obj[a],key=keys[frameIds[a][d.frame]];key.data[d.outHandle?'rightBez':'leftBez']={x:d.xValue-d.frame,y:d.yValue-key.data.numValue};}},
    clearKeyframeVelocity:()=>{},setKeyframeVelocity:()=>{},
    processEvents:()=>{calls.flush++;}
  };
  if(options.nativeMagic) api.getMagicEasing=(l,a,f)=>{
    calls.magicRead++;const d=keys[frameIds[a][f]].data;
    return {easingName:d.easing?'Custom':'None',expression:d.easing?d.exprEasing:''};
  };
  return {host:loadHost(api),api,keys,selected,calls,reads,frame:()=>frame};
}
{
  const f=fixture(),s=f.host.readSelection(math);
  assert.equal(s.count,2);assert.equal(s.expression,''); // key 20 has an outgoing nonmagic interval
  assert.equal(s.mixed,true);assert.equal(s.segments.length,2);
  f.setSelection({'basicShape#1.scale.x':[0]},['keyframe#1']);
  const only=f.host.readSelection(math);assert.equal(only.expression,'pow(x,3)');assert.equal(only.segments[0].endFrame,20);assert.equal(f.frame(),9);
}
{
 const f=fixture();f.setSelection({'basicShape#1.scale.y':[0,20]},['keyframe#4','keyframe#5']);
 const s=f.host.readSelection(math);assert.equal(s.mixed,false);assert.equal(s.expression,'1-pow(1-x,4)');
 assert.equal(s.count,2);assert.equal(s.segments.length,1);
}
{
 const f=fixture();f.setSelection({'basicShape#1.scale.x':[0]},['keyframe#1']);
 const r=f.host.apply('1-pow(1-x,5)');assert.equal(r.changed,1);assert.equal(f.keys['keyframe#1'].data.colorId,11);assert.equal(f.keys['keyframe#1'].data.exprEasing.replace(/\s/g,''),'1-pow(1-x,5)');
 assert.equal(f.keys['keyframe#1'].data.leftBez.x,-2);
 const c=f.host.clear();assert.equal(c.changed,1);assert.equal(f.keys['keyframe#1'].data.easing,0);assert.equal(f.keys['keyframe#1'].data.colorId,16);assert.equal(f.keys['keyframe#1'].data.leftBez.x,-2);
}
{
 const f=fixture();f.setSelection({'basicShape#1.scale.x':[0]},['keyframe#1']);
 const result=f.host.flatten(math);assert.equal(result.changed,1);assert.equal(f.keys['keyframe#1'].data.easing,0);assert.equal(f.keys['keyframe#1'].data.colorId,16);
 assert.equal(f.keys['keyframe#2'].data.rightBez.x,2);assert.equal(f.keys['keyframe#1'].data.leftBez.x,-2);
 assert.ok(f.keys['keyframe#1'].data.rightBez.x>0);assert.ok(f.keys['keyframe#2'].data.leftBez.x<0);
}
{
 const f=fixture();f.setSelection({'basicShape#1.scale.x':[0]},['keyframe#1']);
 f.keys['keyframe#1'].data.exprEasing='x+0.2';const before=JSON.stringify(f.keys);const result=f.host.flatten(math);assert.equal(result.changed,0);assert.equal(JSON.stringify(f.keys),before);assert.equal(f.writes.length,0);
}
{
 const f=fixture();f.setSelection({'basicShape#1.scale.x':[0]},['keyframe#1']);
 f.api.modifyKeyframeTangent=()=>{throw new Error('host tangent error');};const before=JSON.stringify(f.keys);const result=f.host.flatten(math);assert.equal(result.changed,0);assert.equal(JSON.stringify(f.keys),before);
}
{
 const f=fixture();
 const ordinary=JSON.parse(JSON.stringify(f.keys['keyframe#2'].data));
 const result=f.host.flatten(math);assert.equal(result.changed,2);
 assert.equal(f.keys['keyframe#1'].data.colorId,16);assert.equal(f.keys['keyframe#2'].data.colorId,16);
 assert.deepEqual(f.keys['keyframe#2'].data.rightBez,ordinary.rightBez);
 assert.equal(f.keys['keyframe#2'].data.easing,ordinary.easing);
}
{
 const f=fixture();f.setSelection({'basicShape#1.scale.x':[0]},['keyframe#1']);
 f.keys['keyframe#2'].data.interpolation=2;const before=JSON.stringify(f.keys);
 const result=f.host.flatten(math);assert.equal(result.changed,0);assert.equal(JSON.stringify(f.keys),before);
 assert.ok(result.message.includes('following span is Step'));
}
{
 const f=fixture();f.setSelection({'basicShape#1.scale.x':[0,20,40]},['keyframe#1','keyframe#2','keyframe#3']);
 f.keys['keyframe#1'].data.colorId=16;f.keys['keyframe#2'].data.colorId=3;f.keys['keyframe#3'].data.colorId=5;
 let flushes=0;f.api.processEvents=()=>{assert.equal(f.host.isBusy(),true);flushes++;};
 // Matching formulas and the selected terminal key still get Plum.
 const applied=f.host.apply('pow(x,3)');assert.equal(applied.changed,3);
 for(const id of ['keyframe#1','keyframe#2','keyframe#3']) assert.equal(f.keys[id].data.colorId,11);
 // Already-cleared keys are included on every Clear too.
 const clear=f.host.clear(),again=f.host.clear();assert.equal(clear.changed,3);assert.equal(again.changed,3);
 for(const id of ['keyframe#1','keyframe#2','keyframe#3']) assert.equal(f.keys[id].data.colorId,16);
 assert.equal(flushes,3);assert.equal(f.host.isBusy(),false);
}
{
 for(const operation of ['apply','clear','flatten']) {
   const f=fixture();f.setSelection({'basicShape#1.scale.x':[0]},['keyframe#1']);
   const before=JSON.stringify(f.keys),write=f.api.set;
   f.api.set=(id,obj)=>{const d=JSON.parse(JSON.stringify(obj.data));delete d.colorId;write(id,{data:d});};
   const result=operation==='apply'?f.host.apply('pow(x,5)'):f.host[operation](math);
   assert.equal(result.changed,0);assert.equal(result.ok,false);assert.equal(result.skipped,1);
   assert.ok(result.message.includes(operation==='apply'?'Plum':'Silver'));
   assert.ok(result.message.includes('did not retain'));assert.equal(JSON.stringify(f.keys),before);
 }
}
{
 const f=fixture();f.setSelection({'basicShape#1.scale.x':[0]},['keyframe#1']);
 // The new getMagicEasing API takes precedence over legacy numeric fields.
 f.api.getMagicEasing=()=>({easingName:'Custom',expression:'pow(x,5)'});
 const s=f.host.readSelection(math,{samples:false});assert.equal(s.expression,'pow(x,5)');assert.equal(s.previewCurves[0].expression,'pow(x,5)');
 assert.equal(s.previewCurves[0].samples,null);assert.equal(f.frame(),9);
 // An unavailable implementation still falls back to verified 2.7 data fields.
 f.api.getMagicEasing=()=>{throw new Error('not available');};
 assert.equal(f.host.readSelection(math,{samples:false}).expression,'pow(x,3)');
}
{
 const f=fixture();f.setSelection({'basicShape#1.scale.x':[40]},['keyframe#3']);
 f.keys['keyframe#3'].data.easing=34;f.keys['keyframe#3'].data.exprEasing='pow(x,3)';
 const s=f.host.readSelection(math,{samples:false});assert.equal(s.count,1);assert.equal(s.segments.length,0);
 assert.equal(s.previewCurves.length,1);assert.equal(s.previewCurves[0].expression,'pow(x,3)');assert.equal(s.previewCurves[0].samples,null);
 assert.equal(f.host.readSelection(math,{samples:false,preview:false}).previewCurves.length,0);
 f.keys['keyframe#5'].data.easing=34;f.keys['keyframe#5'].data.exprEasing='pow(x,4)';
 f.setSelection({'basicShape#1.scale.x':[40],'basicShape#2.scale.y':[20]},['keyframe#3','keyframe#5']);
 const terminals=f.host.readSelection(math,{samples:false});assert.equal(terminals.segments.length,0);assert.equal(terminals.previewCurves.length,2);
 assert.deepEqual(Array.from(terminals.previewCurves,c=>c.expression),['pow(x,3)','pow(x,4)']);
 assert.equal(terminals.previewCurves[1].layerId,'basicShape#2');
}
{
 const f=fixture();f.setSelection({'basicShape#1.scale.x':[0]},['keyframe#1']);
 f.keys['keyframe#1'].data.easing=0;f.keys['keyframe#1'].data.exprEasing='stale';
 f.keys['keyframe#1'].data.rightBez={x:4,y:20};f.keys['keyframe#2'].data.leftBez={x:-8,y:-10};
 let samples=0;const m=Object.assign({},math,{sample:()=>{samples++;throw new Error('must not sample descriptor');}});
 const curve=f.host.readSelection(m,{samples:false}).previewCurves[0];
 assert.deepEqual({...curve.bezier},{x1:.2,y1:.2,x2:.6,y2:.9});assert.equal(curve.expression,'');assert.equal(curve.samples,null);assert.equal(samples,0);
 f.keys['keyframe#1'].data.interpolation=2;const step=f.host.readSelection(m,{samples:false}).previewCurves[0];
 assert.equal(step.samples.length,3);assert.equal(step.samples[1].y,0);
 f.keys['keyframe#1'].data.interpolation=1;assert.equal(f.host.readSelection(m,{samples:false}).previewCurves[0].samples.length,2);
}
{
 for(const expression of ['', 'native_function(x)']) {
   const f=fixture();f.setSelection({'basicShape#1.scale.x':[0]},['keyframe#1']);
   f.keys['keyframe#1'].data.easing=expression?34:8;f.keys['keyframe#1'].data.exprEasing=expression;
   const get=f.api.get;let sampled=0;
   f.api.get=(id,a)=>{if(a==='data')return get(id,a);sampled++;return 100*Math.pow(f.api.getFrame()/20,2);};
   const curve=f.host.readSelection(math,{samples:false}).previewCurves[0];
   assert.equal(sampled,21);assert.equal(curve.samples.length,21);assert.equal(curve.samples[10].y,.25);assert.equal(f.frame(),9);
   sampled=0;f.host.readSelection(math,{samples:false,preview:false});assert.equal(sampled,0);
 }
 const f=largeFixture(1,{paired:true});
 for(const key of Object.values(f.keys)){key.data.easing=0;key.data.exprEasing='';}
 const s=f.host.readSelection(math,{samples:false});assert.ok(s.segments.every(x=>x.isMotionPath));
 assert.ok(s.previewCurves.every(x=>x.samples&&x.samples.length===11));assert.equal(f.frame(),9);
}
{
 for(const count of [1000,5000]) for(const paired of [false,true]) {
   const f=largeFixture(count,{paired,nativeMagic:true});let samples=0,compiles=0;
   const m=Object.assign({},math,{sample:(fn,n)=>{samples++;return math.sample(fn,n);},compile:expr=>{compiles++;return math.compile(expr);}});
   const s=f.host.readSelection(m,{samples:false});const channels=paired?2:1;
   assert.equal(s.count,count*channels);assert.equal(s.segments.length,count*channels);
   assert.equal(f.calls.times,channels);assert.equal(f.calls.ids,channels);
   assert.equal(f.calls.data,(count+1)*channels);assert.equal(f.calls.magicRead,(count+1)*channels);
   assert.ok(Object.values(f.reads).every(n=>n===1));assert.equal(samples,0);assert.equal(compiles,1);
   assert.equal(s.previewCurves.length,count*channels);assert.equal(f.calls.setFrame,0);
   assert.strictEqual(s.keys[1],s.segments[0].b);assert.equal(s.segments[count-1].endFrame,count*10);
   // Cache scope ends with the read, so external edits cannot leave stale data.
   f.keys[f.selected[0]].data.exprEasing='pow(x,4)';f.keys[f.selected[count-1]].data.exprEasing='pow(x,5)';
   const edited=f.host.readSelection(m,{samples:false});
   assert.equal(edited.keys[0].magic.expression,'pow(x,4)');assert.equal(edited.previewCurves[count-1].expression,'pow(x,5)');
 }
}
{
 for(const bezier of [false,true]) {
   const f=largeFixture(1000,{bezier});let samples=0;
   const m=Object.assign({},math,{sample:(fn,n)=>{samples++;return math.sample(fn,n);}});
   const s=f.host.readSelection(m);assert.equal(s.count,1000);assert.equal(s.previewCurves.length,1000);assert.equal(samples,1);
   assert.ok(s.previewCurves.every(c=>c.samples===s.previewCurves[0].samples));
 }
 const f=largeFixture(10);f.keys[f.selected[1]].data.exprEasing='pow(x,4)';let samples=0;
 const m=Object.assign({},math,{sample:(fn,n)=>{samples++;return math.sample(fn,n);}});
 const curves=f.host.readSelection(m).previewCurves;assert.equal(samples,2);
 assert.notStrictEqual(curves[0].samples,curves[1].samples);assert.strictEqual(curves[0].samples,curves[2].samples);
}
{
 const f=largeFixture(1000);const preview=f.host.readSelection(math,{samples:false,previewLimit:10});
 assert.equal(preview.count,1000);assert.equal(preview.previewCurves.length,10);
 const applied=f.host.apply('pow(x,3)');
 assert.equal(applied.changed,1000);assert.equal(f.calls.magicWrite,1000);assert.equal(f.calls.dataWrite,1000);assert.equal(f.calls.flush,1);
 assert.ok(f.selected.every(id=>f.keys[id].data.colorId===11));assert.equal(f.calls.setFrame,0);
 const cleared=f.host.clear();assert.equal(cleared.changed,1000);assert.equal(f.calls.magicWrite,2000);assert.equal(f.calls.dataWrite,2000);assert.equal(f.calls.flush,2);
 assert.ok(f.selected.every(id=>f.keys[id].data.colorId===16));
}
{
 for(const count of [1000,5000]) for(const samples of [false,true]) {
   const f=largeFixture(count);f.selected.forEach((id,i)=>{f.keys[id].data.exprEasing=i===10?'native_only_function(x)':'pow(x,'+(i+3)+')';});
   const compiled=[],sampled=[];
   const m=Object.assign({},math,{compile:expr=>{compiled.push(expr);return math.compile(expr);},sample:(expr,n)=>{sampled.push(expr);return math.sample(expr,n);}});
   const s=f.host.readSelection(m,{samples,previewLimit:10});
   assert.equal(s.count,count);assert.equal(s.segments.length,count);assert.equal(s.groups[0].keys.length,count);
   assert.equal(s.mixed,true);assert.equal(s.expression,'');assert.equal(s.keys[10].magic.expression,'native_only_function(x)');
   assert.equal(s.previewCurves.length,10);assert.deepEqual(Array.from(s.previewCurves,c=>c.keyId),f.selected.slice(0,10));
   assert.equal(samples?sampled.length:compiled.length,10);assert.equal(samples?compiled.length:sampled.length,0);
   assert.ok([...compiled,...sampled].every(expr=>expr!=='native_only_function(x)'));assert.equal(f.calls.sampleRead,0);assert.equal(f.calls.setFrame,0);
   assert.equal(f.calls.data,count+1);assert.equal(f.calls.times,1);assert.equal(f.calls.ids,1);
 }
}
{
 const f=largeFixture(1000);for(const id of f.selected){f.keys[id].data.easing=8;f.keys[id].data.exprEasing='';}
 let compiles=0;const m=Object.assign({},math,{compile:()=>{compiles++;throw new Error('built-in Magic has no expression');}});
 const s=f.host.readSelection(m,{samples:false,previewLimit:10});
 assert.equal(s.count,1000);assert.equal(s.segments.length,1000);assert.equal(s.previewCurves.length,10);
 assert.deepEqual(Array.from(s.previewCurves,c=>c.startFrame),[0,10,20,30,40,50,60,70,80,90]);
 assert.ok(s.previewCurves.every(c=>c.samples.length===11));assert.equal(compiles,0);
 assert.equal(f.calls.sampleRead,110);assert.equal(f.calls.setFrame,120);assert.equal(f.frame(),9);
 // Previewing ten opaque spans never restricts subsequent selected writes.
 const sampled=f.calls.sampleRead;const applied=f.host.apply('pow(x,3)');assert.equal(applied.changed,1000);assert.equal(f.calls.sampleRead,sampled);
 assert.ok(f.selected.every(id=>f.keys[id].data.colorId===11));
}
{
 const f=largeFixture(12,{channels:['scale.x','scale.y']});
 const terminal='keyframe#scale.x:12',outgoing=f.selected.filter(id=>id.startsWith('keyframe#scale.y:'));
 f.api.getSelectedKeyframes=()=>({'basicShape#1.scale.x':[120],'basicShape#1.scale.y':[110,100,90,80,70,60,50,40,30,20,10,0]});
 f.api.getSelectedKeyframeIds=()=>[terminal,...outgoing];
 const s=f.host.readSelection(math,{samples:false,previewLimit:10});
 assert.equal(s.count,13);assert.equal(s.segments.length,12);assert.equal(s.keys[0].id,terminal);assert.equal(s.groups.length,2);
 assert.equal(s.previewCurves.length,9);assert.deepEqual(Array.from(s.previewCurves,c=>c.keyId),outgoing.slice(0,9));
 assert.equal(s.previewCurves[8].startFrame,80); // terminal consumes a slot; key at90 cannot fill it.
 f.keys[terminal].data.easing=34;f.keys[terminal].data.exprEasing='pow(x,7)';
 const withTerminal=f.host.readSelection(math,{samples:false,previewLimit:10});assert.equal(withTerminal.previewCurves.length,10);
 assert.equal(withTerminal.previewCurves[0].keyId,terminal);assert.equal(withTerminal.previewCurves[0].expression,'pow(x,7)');
 assert.equal(withTerminal.previewCurves[9].startFrame,80);assert.equal(withTerminal.mixed,false); // full outgoing-expression semantics stay intact.
 const unlimited=f.host.readSelection(math,{samples:false});assert.equal(unlimited.previewCurves.length,12); // legacy unlimited mixed-terminal behavior
}
{
 const channels=Array.from({length:14},(_,i)=>'channel.'+i),f=largeFixture(0,{channels,selectTerminal:true});
 f.selected.forEach((id,i)=>{if(i){f.keys[id].data.easing=34;f.keys[id].data.exprEasing='pow(x,'+(i+2)+')';}});
 const sampled=[];const m=Object.assign({},math,{sample:(expr,n)=>{sampled.push(expr);return math.sample(expr,n);}});
 const s=f.host.readSelection(m,{previewLimit:10});assert.equal(s.count,14);assert.equal(s.segments.length,0);assert.equal(s.groups.length,14);
 assert.equal(s.previewCurves.length,9);assert.equal(sampled.length,9);assert.equal(s.mixed,true);
 assert.deepEqual(Array.from(s.previewCurves,c=>c.keyId),f.selected.slice(1,10));assert.equal(f.calls.sampleRead,0);
 assert.equal(f.host.readSelection(math,{samples:false}).previewCurves.length,13);
}
{
 const f=largeFixture(20);let sampled=0,compiled=0;
 const m=Object.assign({},math,{sample:()=>{sampled++;throw new Error('no preview');},compile:()=>{compiled++;throw new Error('no preview');}});
 for(const previewLimit of [0,-10]) {
   const s=f.host.readSelection(m,{previewLimit});assert.equal(s.count,20);assert.equal(s.segments.length,20);assert.equal(s.previewCurves.length,0);
 }
 assert.equal(f.host.readSelection(m,{preview:false,previewLimit:10}).previewCurves.length,0);
 assert.equal(sampled,0);assert.equal(compiled,0);assert.equal(f.calls.sampleRead,0);assert.equal(f.calls.setFrame,0);
}
{
 const f=largeFixture(25);assert.equal(f.host.readSelection(math,{samples:false,previewLimit:10}).previewCurves.length,10);
 const fit=math.fitBezier(math.compile('pow(x,3)'),{optimizeX:true});let fitted=0;
 const m=Object.assign({},math,{fitBezier:()=>{fitted++;return {...fit};}});
 const result=f.host.flatten(m);assert.equal(result.changed,25);assert.equal(result.skipped,0);assert.equal(fitted,25);assert.equal(result.fits.length,25);
 assert.ok(f.selected.every(id=>f.keys[id].data.colorId===16&&f.keys[id].data.easing===0));
 assert.equal(f.calls.magicWrite,25);assert.equal(f.calls.sampleRead,0);
}
console.log('Measey adapter: 23 integration groups passed, including preview-key budgets, full selected writes and 1000/5000-key read bounds.');
