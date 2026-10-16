const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const widgets = [], renderedText = [], timers = [], nativeEvents = [], modalCalls = [], modalReplies = [], modalMessages = [];
let stateReads=0,compileCalls=0,evaluations=0,curvePathBuilds=0;
let resizes = 0, redraws = 0, dimensions = {width:640,height:700}, drawOffsetX = 0;
const allocated = {graph:440,slider:420,divider:432};
class Widget {
  constructor(value) { this.value=value; this.children=[]; widgets.push(this); }
  setText(value) { this.value=value; if (this.onValueChanged) this.onValueChanged(); if (this.echoCommitted && this.onValueCommitted) this.onValueCommitted(); }
  getText() { return this.value || ''; }
  setSize(w,h) { this.w=w; this.h=h; resizes++; }
  add(...items) { for (const item of items) { item.layoutParent=this; nativeEvents.push({type:'add',widget:this,item}); } this.children.push(...items); }
  clear() { nativeEvents.push({type:'clear',widget:this}); for (const child of this.children) destroyOwnedWidget(child); this.children=[]; }
  setLayout(layout) { this.layout=layout; }
  setMargins(...values) { this.margins=values; }
  setContentsMargins(...values) { this.contentsMargins=values; }
  setSpaceBetween(value) { this.spacing=value; }
  setCornerRounding(value) { this.cornerRadius=value; }
  setRadius(...values) { this.radius=values; }
  setAlignment(value) { this.alignment=value; }
  setPreferredPopoverSide(value) { this.popoverSide=value; }
  showAsPopover(x,y) { assert.strictEqual(this.layoutParent,undefined,'Popover opens without attachment to a hidden layout'); this.popoverPosition={x,y}; this.popoverOpen=true; this.windowOpen=true; this.hidden=false; this.everShown=true; this.nativeWindowAlive=true; nativeEvents.push({type:'popover',widget:this}); }
  show() { assert.strictEqual(this.layoutParent,undefined,'Secondary window opens without attachment to a hidden layout'); this.windowOpen=true; this.hidden=false; this.everShown=true; this.nativeWindowAlive=true; nativeEvents.push({type:'show',widget:this}); }
  move(x,y) { this.windowPosition={x,y}; nativeEvents.push({type:'move',widget:this}); }
  setHidden(value) { this.hidden=value; if (value) { this.windowOpen=false; this.popoverOpen=false; } nativeEvents.push({type:'hidden',widget:this,value}); }
  isHidden() { return this.hidden===true; }
  close() { this.popoverOpen=false; this.windowOpen=false; this.hidden=true; this.closed=true; nativeEvents.push({type:'close',widget:this}); if (this.onClose) this.onClose(); }
  geometry() {
    let width=this.w || this.fixedWidth || 0;
    if (this.kind==='Container' && this.layout && this.layout.children.length===1 && this.layout.children[0].kind==='Draw') {
      if (this.onMouseDoubleClick) width=allocated.divider;
      else if (/^Drag (whole-number )?Power/.test(this.tooltip || '')) width=allocated.slider;
      else if (this.layout.children[0].role==='graph') width=allocated.graph;
    }
    const left=100+(this.role==='graph'?drawOffsetX:0);
    const height=this.h || this.fixedHeight || 0;
    return {x:left,y:200,left,top:200,width,height,centre:this.nativeCentre || {x:left+width/2,y:200+height/2}};
  }
  getHeightForWidth(w) { return Math.ceil(this.children.length / Math.max(1,Math.floor(w/80))) * 112; }
  clearPaths() { this.paths=[]; }
  addPath(path,paint) { this.paths.push({path,paint}); }
  redraw() { redraws++; }
}
function destroyOwnedWidget(widget) {
  assert(!widget.deleted,'An owned widget is deleted once');
  for (const child of widget.children || []) destroyOwnedWidget(child);
  if (widget.layout) destroyOwnedWidget(widget.layout);
  widget.deleted=true; widget.windowOpen=false; widget.nativeWindowAlive=false; nativeEvents.push({type:'delete',widget});
}
for (const key of ['setDrawStroke','addStretch']) Widget.prototype[key]=function() {};
Widget.prototype.setFontSize=function(value) { this.fontSize=value; };
Widget.prototype.setTransparentForMouseEvents=function(value) { this.transparentForMouseEvents=value; };
Widget.prototype.useHoverEvents=function(value) { this.hoverEvents=value; };
Widget.prototype.setToolTip=function(value) { this.tooltip=value; if (/curve preview/i.test(value)) this.role='graph'; };
for (const [method,property] of Object.entries({setMinimumWidth:'minWidth',setMaximumWidth:'maxWidth',setFixedHeight:'fixedHeight',setMinimumHeight:'minHeight',setMaximumHeight:'maxHeight',setFixedWidth:'fixedWidth',setBackgroundColor:'background',setPlaceholder:'placeholder',setTextColor:'textColor',setEnabled:'enabled'})) Widget.prototype[method]=function(value) { this[property]=value; };
// Native layout.clear() destroys descendants; stale callbacks must never use them.
for (const method of Object.getOwnPropertyNames(Widget.prototype).filter(name=>name!=='constructor')) {
  const native=Widget.prototype[method]; Widget.prototype[method]=function(...args) { assert(!this.deleted,method+' cannot access a deleted '+this.kind); return native.apply(this,args); };
}
class Path {
  constructor() { this.points=[]; this.commands=[]; this.texts=[]; }
  point(x,y) { assert(Number.isFinite(x) && Number.isFinite(y)); this.points.push([x,y]); }
  moveTo(x,y) { this.commands.push('M'); this.point(x,y); }
  lineTo(x,y) { this.commands.push('L'); this.point(x,y); }
  cubicTo(...coordinates) { this.commands.push('C'); for (let i=0;i<coordinates.length;i+=2) this.point(coordinates[i],coordinates[i+1]); }
  close() { this.commands.push('Z'); }
  addText(text,size,x,y) {
    text=String(text); renderedText.push(text); this.commands.push('T'); this.texts.push({text,size,x,y});
    const width=text.length*size*.6; this.point(x,y-2); this.point(x+width,y-2); this.point(x+width,y+size*.8); this.point(x,y+size*.8);
  }
  boundingBox() { const b=bounds(this.points); return {...b,x:b.left,y:b.bottom,width:b.right-b.left,height:b.top-b.bottom}; }
  translate(x,y) { for (const point of this.points) { point[0]+=x; point[1]+=y; } for (const text of this.texts) { text.x+=x; text.y+=y; } }
  toObject() { if (this.points.length===151) curvePathBuilds++; Object.defineProperties(this.points,{commands:{value:this.commands,enumerable:false,configurable:true},texts:{value:this.texts,enumerable:false,configurable:true}}); return this.points; }
}
class Timer {
  constructor(callback) { this.callback=callback; this.running=false; timers.push(this); }
  setInterval(value) { this.interval=value; }
  setRepeating(value) { this.repeating=value; }
  start() { this.running=true; }
  stop() { this.running=false; this.stopped=true; }
  tick() { if (this.running) this.callback.onTimeout(); }
}
function bounds(path) { return {left:Math.min(...path.map(p=>p[0])),right:Math.max(...path.map(p=>p[0])),bottom:Math.min(...path.map(p=>p[1])),top:Math.max(...path.map(p=>p[1]))}; }
function near(actual,expected,message) { assert(Math.abs(actual-expected)<1e-8,message || actual+' != '+expected); }
const ui={
  add(widget) { this.root=widget; }, setMinimumWidth(value) { this.minWidth=value; }, setMinimumHeight(value) { this.minHeight=value; },
  setBackgroundColor(value) { this.background=value; }, setMargins() {}, setSpaceBetween() {},
  getThemeColor(key) { return key==='Text'?'#eeeeee':'#333333'; }, size() { return dimensions; },
  clearContextMenu() { this.menu=[]; }, addMenuItem(item) { this.menu.push(item); }, showContextMenu() { this.menuShows=(this.menuShows || 0)+1; }
};
ui.Modal=class {
  showStringInput(title,caption,current) { modalCalls.push({title,caption,current}); const reply=modalReplies.length?modalReplies.shift():''; return typeof reply==='function'?reply({title,caption,current}):reply; }
  showMessage(text) { modalMessages.push(text); }
};
for (const kind of ['VLayout','HLayout','FlowLayout','Label','Button','Draw','LineEdit','Container']) ui[kind]=class extends Widget { constructor(value) { super(value); this.kind=kind; } };
// ScrollView is a Layout in Cavalry, with no common Widget methods.
ui.ScrollView=class {
  constructor() { this.kind='ScrollView'; widgets.push(this); }
  setLayout(layout) { this.layout=layout; }
  setSize(w,h) { this.fixedWidth=w; this.fixedHeight=h; }
  setFixedWidth(value) { this.fixedWidth=value; } setFixedHeight(value) { this.fixedHeight=value; }
  alwaysShowVerticalScrollBar() {} alwaysShowHorizontalScrollBar() {}
};
const ctx={console,cavalry:{Path},ui,api:{Timer}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname+'/../src/curve-math.js','utf8')+'\n'+fs.readFileSync(__dirname+'/../src/measey-ui.js','utf8'),ctx);
const realCompile=ctx.MeaseyMath.compile;
ctx.MeaseyMath.compile=function(source) { compileCalls++; const fn=realCompile(source); const counted=function(x) { evaluations++; return fn(x); }; Object.assign(counted,fn); return counted; };
const s={expression:'x^3',layout:'grid',mode:'value',graphHeight:210,power:4,powerSelected:true,maxPower:12,bothMidpoint:0.5,bottom:0,top:0,direction:'out',libraryName:'My curves',canApplyPower:true,applyOnDrag:false,selectedPowerLevels:[1,2,3,4,1.539,'?'],selectionPreviewCurves:[{expression:'x^2'},{expression:'1-(1-x)^3'}]};
let edits=0,presets=[];
const powerCalls=[],bothCalls=[],endpointCalls=[],directionCalls=[],actions=[];
function updatePowerExpression() { s.powerExpression=ctx.MeaseyMath.powerExpression(s.power,s.direction,s.bothMidpoint,s.bottom,s.top); }
updatePowerExpression();
const controller={
  getState() { stateReads++; return s; }, getPresets() { return presets; },
  editExpression(text) { edits++; s.expression=text; s.powerExpression=text; s.powerSelected=!!ctx.MeaseyMath.detectPower(text); },
  setPower(value,committed,source) { powerCalls.push([value,committed,source]); const parsed=Number(String(value).replace(',','.')); if (Number.isFinite(parsed) && parsed>=1) { s.power=parsed; s.powerSelected=true; updatePowerExpression(); } },
  setDirection(value) { directionCalls.push(value); s.direction=value; s.powerSelected=true; updatePowerExpression(); },
  setBothMidpoint(value,committed,source) { bothCalls.push([value,committed,source]); s.bothMidpoint=value; updatePowerExpression(); },
  setEndpoint(side,value,committed,source) { endpointCalls.push([side,value,committed,source]); s[side]=value; s.powerSelected=true; updatePowerExpression(); },
  resetWeights() { actions.push(['resetWeights']); s.bottom=s.top=0; s.bothMidpoint=.5; updatePowerExpression(); },
  savePreferences(value) { Object.assign(s,value); }
};
for (const name of ['applyPower','apply','flatten','clear','getSelection','showSettings','showLibrarySettings','selectPreset','deletePreset','openMidpointEditor','openWeightEditor']) controller[name]=function(...args) { actions.push([name,...args]); };
const panel=ctx.buildMeaseyUI(controller,ctx.MeaseyMath); panel.resize();
assert.strictEqual(ui.minWidth,220); assert.strictEqual(ui.minHeight,260); assert.strictEqual(ui.root.kind,'ScrollView');
assert.strictEqual(widgets.filter(w=>w.kind==='ScrollView').length,1); assert.strictEqual(ui.root.fixedHeight,undefined);
assert(!widgets.some(w=>w.kind==='Label' && /DEFAULT PRESETS|SELECT KEY|MANUAL|AUTO/.test(w.value || '')),'No persistent status or default-preset labels');
assert(!widgets.some(w=>/POWER \d|NONE \/ CLEAR/.test(w.value || '')),'An empty library renders no default presets');
const [input,powerField]=widgets.filter(w=>w.kind==='LineEdit');
assert(input && powerField && widgets.filter(w=>w.kind==='LineEdit').length===2);
for (const control of widgets.filter(w=>w.kind==='Button' || w.kind==='LineEdit')) {
  assert.strictEqual(control.fixedHeight,28); assert.strictEqual(control.cornerRadius,3);
  assert.deepStrictEqual(control.contentsMargins,[0,0,0,0],'Native controls paint their full bounds without inset strips');
}
const fieldHosts=[input,powerField].map(editor=>widgets.find(w=>w.kind==='Container' && w.layout && w.layout.children.includes(editor)));
for (let i=0;i<2;i++) { const host=fieldHosts[i],editor=[input,powerField][i]; assert(host); assert.strictEqual(host.fixedHeight,28); assert.deepStrictEqual(host.radius,[3,3,3,3]); assert.deepStrictEqual(host.layout.margins,[6,0,6,0]); assert.strictEqual(host.background,editor.background); }
assert.strictEqual(fieldHosts[1].fixedWidth,76); assert.strictEqual(powerField.fixedWidth,undefined);
const groups=widgets.filter(w=>w.kind==='Container' && w.radius && w.radius.every(r=>r===5));
assert.strictEqual(groups.length,4); for (const group of groups) { assert.strictEqual(group.fixedHeight,34); assert.deepStrictEqual(group.layout.margins,[3,3,3,3]); }
assert(!widgets.some(w=>w.kind==='Label' && w.value==='CUSTOM EXPRESSION'),'Custom input has no redundant heading');
assert(!widgets.some(w=>w.fixedHeight===1),'No one-pixel section rule remains');
const powerHeading=widgets.find(w=>w.kind==='Label' && w.value==='POWER'), libraryHeading=widgets.find(w=>w.kind==='Label' && w.value==='LIBRARY');
const powerRow=widgets.find(w=>w.kind==='HLayout' && w.children.includes(powerHeading)),libraryRow=widgets.find(w=>w.kind==='HLayout' && w.children.includes(libraryHeading));
const selectedLevels=powerRow.children[1],libraryName=libraryRow.children[1];
assert.strictEqual(powerHeading.fixedWidth,54); assert.strictEqual(libraryHeading.fixedWidth,54); assert.strictEqual(powerRow.spacing,12); assert.strictEqual(libraryRow.spacing,12);
assert.strictEqual(selectedLevels.value,s.selectedPowerLevels.join(', ')); assert.strictEqual(selectedLevels.tooltip,s.selectedPowerLevels.join(', '));
assert.strictEqual(libraryName.value,'My curves'); assert.strictEqual(libraryName.textColor,'#ffffff'); assert.notStrictEqual(libraryHeading.textColor,'#ffffff');
const graph=widgets.find(w=>w.kind==='Draw' && w.role==='graph');
const graphHost=widgets.find(w=>w.kind==='Container' && w.layout && w.layout.children.includes(graph));
s.selectionPreviewLimited=true; panel.refresh();
assert.match(graph.tooltip,/Showing the first 10 selected keyframes/); assert.match(graph.tooltip,/Apply, Clear and Flatten use the full selection/);
assert.strictEqual(selectedLevels.tooltip,s.selectedPowerLevels.join(', '),'The graph budget leaves the full Power readout intact');
s.selectionPreviewLimited=false; panel.refresh(); assert(!graph.tooltip.includes('Showing the first 10'));
const divider=widgets.find(w=>w.kind==='Container' && /Drag to resize/.test(w.tooltip || '')),dividerCanvas=divider.layout.children[0];
const slider=widgets.find(w=>w.kind==='Container' && /^Drag whole-number Power/.test(w.tooltip || '')),sliderCanvas=slider.layout.children[0];
const main=ui.root.layout,graphBlock=widgets.find(w=>w.kind==='VLayout' && w.children.includes(graphHost) && w.children.includes(divider)),inputGroup=groups.find(w=>w.layout.children.includes(fieldHosts[0])),powerBlock=widgets.find(w=>w.kind==='VLayout' && w.children.includes(powerRow) && w.children.includes(slider));
assert(graphBlock && inputGroup && powerBlock); assert.strictEqual(graphBlock.spacing,6); assert.deepStrictEqual(graphBlock.children,[graphHost,divider]);
assert.deepStrictEqual(main.children.slice(1,4),[graphBlock,inputGroup,powerBlock],'Custom input group immediately follows the graph and its resize handle');
assert.strictEqual(graph.w,440); assert.strictEqual(sliderCanvas.w,420); assert.strictEqual(sliderCanvas.h,34); assert.strictEqual(slider.fixedHeight,34); assert.deepStrictEqual(slider.layout.margins,[0,0,0,0]);
const graphBounds=bounds(graph.paths.flatMap(p=>p.path)); near(graphBounds.left,1.5); near(graphBounds.right,438.5); assert.strictEqual(renderedText.length,0);
assert.strictEqual(graph.transparentForMouseEvents,true,'Graph Draw routes mouse events to its parent'); assert.strictEqual(graphHost.hoverEvents,true); assert.deepStrictEqual(graphHost.layout.margins,[0,0,0,0]);
function assertGridAndAxes() {
  const lines=graph.paths.filter(p=>p.path.length===2);
  assert(lines.length>=2 && lines.every(p=>p.paint.color==='#434343'),'Grid and axes share434343');
  const bottom=lines.filter(p=>p.path[0][1]===2 && p.path[1][1]===2);
  const left=lines.filter(p=>p.path[0][0]===1.5 && p.path[1][0]===1.5);
  assert(bottom.length && left.length,'Bottom and left axes remain visible');
  for (const axis of lines.slice(-2)) assert.deepStrictEqual(axis.paint,lines[0].paint,'Axes use the same line style as guidelines');
}
function selectedHandleColor() {
  const caption=s.direction==='in out'?'Both':s.direction==='in'?'In':'Out';
  return widgets.find(w=>w.kind==='Button' && w.value===caption).background;
}
assertGridAndAxes();
function graphCurves() { return graph.paths.filter(p=>p.path.length===151); }
let curves=graphCurves(); assert.strictEqual(curves.length,3,'Every selected curve and current Power are visible');
assert.strictEqual(curves[2].paint.color,'#c58bd0','Power is painted pink and last'); assert.strictEqual(curves[0].paint.color,curves[1].paint.color); assert.notStrictEqual(curves[0].paint.color,'#c58bd0');
assert.strictEqual(timers.length,1); const layoutTimer=timers[0]; assert.strictEqual(layoutTimer.interval,120); assert.strictEqual(layoutTimer.repeating,true); assert.strictEqual(layoutTimer.running,true);
const settled=resizes,settledDraws=redraws; for (let i=0;i<25;i++) { panel.resize(); layoutTimer.tick(); }
assert.strictEqual(resizes,settled); assert.strictEqual(redraws,settledDraws,'Unchanged resize/timer checks do not repaint the panel');
let dividerBounds=bounds(dividerCanvas.paths[0].path); near(dividerBounds.right-dividerBounds.left,54); near(dividerBounds.top-dividerBounds.bottom,3); assert.strictEqual(dividerCanvas.paths[0].paint.stroke,undefined);
assert.strictEqual(dividerCanvas.paths[0].paint.color,'#434343'); divider.onMouseEnter(); assert.strictEqual(dividerCanvas.paths[0].paint.color,selectedHandleColor(),'Divider hover matches selected direction background');
panel.refresh(); panel.resize(211); assert.strictEqual(dividerCanvas.paths[0].paint.color,selectedHandleColor(),'Hover survives refresh and resizing'); panel.resize(210); divider.onMouseLeave(); assert.strictEqual(dividerCanvas.paths[0].paint.color,'#434343');
divider.onMousePress({x:30,y:4},'left'); const dragColor=dividerCanvas.paths[0].paint.color; assert.strictEqual(dragColor,'#c58bd0');
let pressedDivider=bounds(dividerCanvas.paths[0].path); near(pressedDivider.right-pressedDivider.left,78); near(pressedDivider.top-pressedDivider.bottom,3,'Pressed divider keeps3px thickness'); assert.strictEqual(dividerCanvas.paths[0].path.commands.filter(c=>c==='C').length,4,'Resize bar remains rounded');
panel.refresh(); assert.strictEqual(dividerCanvas.paths[0].paint.color,dragColor); divider.onMouseMove({x:30,y:-46}); assert.strictEqual(dividerCanvas.paths[0].paint.color,dragColor); divider.onMouseMove({x:30,y:-16}); divider.onMouseRelease(); assert.strictEqual(s.graphHeight,280); assert.strictEqual(dividerCanvas.paths[0].paint.color,'#434343');
s.graphHeight=210; panel.layoutChanged(); assert.strictEqual(graph.h,210); divider.onMousePress({x:30,y:4},'left'); divider.onMouseRelease({x:30,y:-46},'left'); assert.strictEqual(s.graphHeight,260);
input.value='1-pow(1-x,4)'; input.onValueChanged(); assert.strictEqual(edits,1); const customText=input.getText();
const originalSelectionPaths=graphCurves().slice(0,2).map(p=>p.path);
powerField.value='1,'; powerField.onValueChanged(); panel.refresh(); assert.strictEqual(powerField.getText(),'1,'); assert.strictEqual(powerCalls.length,0);
powerField.value='1,539'; powerField.onValueChanged(); powerField.onValueCommitted(); assert.deepStrictEqual(powerCalls.pop(),['1,539',true,'numeric']); assert.strictEqual(s.power,1.539); assert.strictEqual(powerField.getText(),'1.539');
powerField.value='2.718'; powerField.onValueChanged(); powerField.onValueCommitted(); assert.deepStrictEqual(powerCalls.pop(),['2.718',true,'numeric']); assert.strictEqual(input.getText(),customText);
curves=graphCurves(); assert.deepStrictEqual(curves.slice(0,2).map(p=>p.path),originalSelectionPaths,'Power edits preserve gray selected curves'); assert.strictEqual(curves.at(-1).paint.color,'#c58bd0');
// Power's slider range is a soft maximum; precise typed values remain exact.
powerField.value='12,'; powerField.onValueChanged(); const incompleteCalls=powerCalls.length;
panel.refresh(); panel.resize(graph.h+1); layoutTimer.tick(); panel.resize(graph.h-1);
assert.strictEqual(powerField.getText(),'12,','Refresh and docking preserve an incomplete decimal draft'); assert.strictEqual(powerCalls.length,incompleteCalls);
for (const [entered,number] of [['12,0001',12.0001],['20.539',20.539],['120,0001',120.0001]]) {
  powerField.value=entered; powerField.onValueChanged(); powerField.onValueCommitted();
  assert.deepStrictEqual(powerCalls.pop(),[entered,true,'numeric']); near(s.power,number); assert.strictEqual(powerField.getText(),String(number));
  panel.refresh(); layoutTimer.tick(); assert.strictEqual(powerField.getText(),String(number),'Typed precision survives refresh');
  const softMarker=bounds(sliderCanvas.paths.at(-1).path); near((softMarker.left+softMarker.right)/2,sliderCanvas.w-7.5,'Above12 keeps the slider marker at its soft maximum');
  assert.strictEqual(sliderCanvas.paths.length,15,'Slider still contains exactly12 integer ticks');
}
powerField.echoCommitted=true; const beforeEcho=powerCalls.length; s.power=15.539; updatePowerExpression(); panel.refresh();
assert.strictEqual(powerField.getText(),'15.539'); assert.strictEqual(powerCalls.length,beforeEcho,'Programmatic text callback echo is ignored while syncing');
powerField.echoCommitted=false; powerField.onValueCommitted(); assert.deepStrictEqual(powerCalls.pop(),['15.539',true,'numeric']); near(s.power,15.539,'A later commit keeps the typed decimal rather than using the capped slider');
slider.onMousePress({x:7.5,y:10},'left'); assert.deepStrictEqual(powerCalls.pop(),[1,false,'slider']); slider.onMouseMove({x:210,y:10}); assert.deepStrictEqual(powerCalls.pop(),[7,false,'slider']); slider.onMouseRelease({x:412.5,y:10},'left'); assert.deepStrictEqual(powerCalls.pop(),[12,true,'slider']);
let track=bounds(sliderCanvas.paths[0].path),fill=bounds(sliderCanvas.paths[1].path),marker=bounds(sliderCanvas.paths.at(-1).path);
assert.deepStrictEqual(track,{left:0,right:420,bottom:0,top:34}); assert.deepStrictEqual(fill,{left:3,right:417,bottom:3,top:31}); near(marker.right-marker.left,3); near(fill.right-marker.right,3); near(marker.bottom-fill.bottom,3); near(fill.top-marker.top,3);
const marks=sliderCanvas.paths.slice(2,-1); assert.strictEqual(marks.length,12);
for (let i=0;i<marks.length;i++) { const b=bounds(marks[i].path); near(b.right-b.left,2); near(b.top-b.bottom,6); near((b.left+b.right)/2,7.5+i/11*(420-15)); near((b.bottom+b.top)/2,17); assert.strictEqual(marks[i].paint.color,'#373737'); }
near((marker.left+marker.right)/2,(bounds(marks.at(-1).path).left+bounds(marks.at(-1).path).right)/2,'Step ticks share exact handle mapping');
slider.onMousePress({x:210,y:10},'left'); assert.deepStrictEqual(powerCalls.pop(),[7,false,'slider']);
let pressedSliderMarker=bounds(sliderCanvas.paths.at(-1).path); near(pressedSliderMarker.right-pressedSliderMarker.left,3,'Slider handle remains3px while pressed'); near(pressedSliderMarker.top-pressedSliderMarker.bottom,marker.top-marker.bottom);
slider.onMouseRelease({x:210,y:10},'left'); assert.deepStrictEqual(powerCalls.pop(),[7,true,'slider']);
slider.onMousePress({x:-100,y:10},'left'); powerCalls.length=0; slider.onMouseRelease({x:210,y:10},'left'); assert.deepStrictEqual(powerCalls.pop(),[7,true,'slider']); slider.onMousePress({x:10000,y:10},'left'); assert.deepStrictEqual(powerCalls.pop(),[12,false,'slider']); slider.onMouseRelease({x:-100,y:10},'left'); assert.deepStrictEqual(powerCalls.pop(),[1,true,'slider']);
assert.strictEqual(input.getText(),customText);
const directionControls=['In','Both','Out'].map(name=>widgets.find(w=>w.kind==='Button' && w.value===name)); for (const button of directionControls) button.onClick(); assert.deepStrictEqual(directionCalls,['in','in out','out']); assert.strictEqual(input.getText(),customText); assert.strictEqual(edits,1); assert.notStrictEqual(directionControls[2].background,directionControls[0].background);
// An arbitrary custom expression must not imply a Power slider/direction setting.
const customState={expression:s.expression,power:s.power,direction:s.direction};
function assertNoPowerSelection(currentCurveCount) {
  assert.strictEqual(s.powerSelected,false); assert.strictEqual(powerField.getText(),'');
  assert(directionControls.every(button=>button.background===directionControls[0].background),'All Power directions are unselected for a custom expression');
  assert.strictEqual(guidePath(),undefined,'Custom expressions have no Both guide');
  assert.strictEqual(sliderCanvas.paths.length,13,'Unselected Power slider has only its track and12 ticks');
  assert(!sliderCanvas.paths.some(p=>p.paint.color==='#c58bd0'),'Unselected slider has no purple marker');
  assert.strictEqual(graphCurves().length,2+currentCurveCount);
  assert.strictEqual(graphCurves().filter(p=>p.paint.color==='#c58bd0').length,currentCurveCount,'Only a valid provided custom preview can supply the accent curve');
}
s.direction='in out'; input.value='x + 0.02*sin(2*PI*x)'; input.onValueChanged(); assertNoPowerSelection(1);
assert.deepStrictEqual(graphCurves().slice(0,2).map(p=>p.path),originalSelectionPaths,'Custom preview keeps selected gray curves');
input.value=''; input.onValueChanged(); assertNoPowerSelection(0);
input.value='x^'; input.onValueChanged(); assertNoPowerSelection(0);
// A click at the retained whole-number Power reselects even without changing its value.
const retainedPower=s.power,retainedX=7.5+(retainedPower-1)/11*(sliderCanvas.w-15);
slider.onMousePress({x:retainedX,y:10},'left'); assert.deepStrictEqual(powerCalls.pop(),[retainedPower,false,'slider']); assert.strictEqual(s.powerSelected,true); assert.strictEqual(powerField.getText(),String(retainedPower));
slider.onMouseRelease({x:retainedX,y:10},'left'); assert.deepStrictEqual(powerCalls.pop(),[retainedPower,true,'slider']);
input.value='x + 0.02*sin(2*PI*x)'; input.onValueChanged(); assertNoPowerSelection(1);
powerField.value='3,375'; powerField.onValueChanged(); powerField.onValueCommitted(); assert.deepStrictEqual(powerCalls.pop(),['3,375',true,'numeric']); assert.strictEqual(s.powerSelected,true); assert.strictEqual(powerField.getText(),'3.375'); assert(guidePath(),'Typing Power restores Both guide');
assert.notStrictEqual(directionControls[1].background,directionControls[0].background); assert.strictEqual(sliderCanvas.paths.length,15,'Typing Power restores slider fill and marker');
Object.assign(s,customState,{powerSelected:true}); updatePowerExpression(); panel.refresh(); assert.strictEqual(input.getText(),customText);
// The Both guide is a parent-routed interaction, separate from Power and custom input.
function guidePath() { return graph.paths.find(p=>p.path.commands && p.path.commands.includes('Z') && !p.paint.stroke && Math.abs(bounds(p.path).right-bounds(p.path).left-3)<1e-8 && bounds(p.path).top-bounds(p.path).bottom>3); }
function guideCenter() { const b=bounds(guidePath().path); return (b.left+b.right)/2; }
function both(value=0.5) { s.direction='in out'; s.bothMidpoint=value; s.power=4; s.powerSelected=true; updatePowerExpression(); panel.refresh(); }
function pointerFor(value,grabOffset=0) { return {x:1.5+value*(graph.w-3)+drawOffsetX+grabOffset,y:50}; }
function endpointCentre(side,value=Number(s[side]) || 0) { const span=(graph.h-4)/2-14; return side==='bottom'?10+value*span:graph.h-10-value*span; }
function endpointPointer(side,value=Number(s[side]) || 0,grabOffset=0,x=graph.w/2) { return {x:x+drawOffsetX,y:endpointCentre(side,value)+grabOffset}; }
function endpointPaths() { return graph.paths.filter(p=>p.path.commands && p.path.commands.includes('Z') && !p.paint.stroke && Math.abs(bounds(p.path).top-bounds(p.path).bottom-3)<1e-8 && bounds(p.path).right-bounds(p.path).left>3); }
function endpointBar(side) { return endpointPaths().find(p=>Math.abs((bounds(p.path).top+bounds(p.path).bottom)/2-endpointCentre(side))<1e-8); }
function graphLabels() { return graph.paths.filter(p=>p.path.texts && p.path.texts.length); }
function assertWeightLabel(kind) {
  const labels=graphLabels(); assert.strictEqual(labels.length,1,'Only the hovered or dragged handle shows its value');
  const label=labels[0],text=label.path.texts[0],b=bounds(label.path),value=kind==='midpoint'?s.bothMidpoint:(Number(s[kind]) || 0);
  assert.strictEqual(text.text,String(value)); assert.strictEqual(text.size,10); assert.strictEqual(label.paint.color,libraryHeading.textColor); assert.strictEqual(label.paint.stroke,false);
  const width=b.right-b.left,rawX=kind==='bottom'?graph.w-1.5-width-6:kind==='top'?7.5:guideCenter()+6;
  const rawY=kind==='bottom'?endpointCentre('bottom')+6:kind==='top'?endpointCentre('top')-14:graph.h/2;
  near(b.left,Math.max(4.5,Math.min(graph.w-4.5-width,rawX))); near(text.y,Math.max(5,Math.min(graph.h-14,rawY)));
  assert(b.left>=1.5 && b.right<=graph.w-1.5 && b.bottom>=2 && b.top<=graph.h-2,'Handle label stays within the plot');
  const index=graph.paths.indexOf(label); assert(graphCurves().every(p=>graph.paths.indexOf(p)<index),'Handle labels paint after all curves');
}
function assertEndpoints(sides,hoverSide=null,dragSide=null) {
  assert.strictEqual(endpointPaths().length,sides.length,'Only active endpoint directions display handles');
  for (const side of sides) {
    const path=endpointBar(side); assert(path,side+' endpoint bar exists'); const b=bounds(path.path),pressed=side===dragSide;
    near(b.top-b.bottom,3,'Endpoint bar remains3px thick'); near(b.left,pressed?1.5:7.5); near(b.right,graph.w-(pressed?1.5:7.5)); near((b.bottom+b.top)/2,endpointCentre(side));
    assert(b.left>=1.5 && b.right<=graph.w-1.5 && b.bottom>=2 && b.top<=graph.h-2,'Endpoint bar stays inside the plot');
    assert.strictEqual(path.path.commands.filter(c=>c==='C').length,4,'Endpoint handles share the rounded horizontal-bar style');
    assert.strictEqual(path.paint.color,pressed?'#c58bd0':side===hoverSide?selectedHandleColor():'#434343');
    const index=graph.paths.indexOf(path),lines=graph.paths.filter(p=>p.path.length===2),curves=graphCurves();
    assert(lines.every(p=>graph.paths.indexOf(p)<index),'Endpoint bar overlays every grid line and axis');
    assert(curves.every(p=>graph.paths.indexOf(p)>index),'All selected and current curves overlay endpoint bars');
  }
  if (dragSide || hoverSide) assertWeightLabel(dragSide || hoverSide);
  else assert.strictEqual(graphLabels().length,0,'Idle endpoint handles hide their values');
}
function assertGuide(color,pressed=false) {
  const path=guidePath(); assert(path,'Both displays a guide'); const b=bounds(path.path);
  assert.strictEqual(path.paint.color,color); near(b.right-b.left,3,'Guide stays3px thick');
  near(b.bottom,pressed?2:8); near(b.top,pressed?graph.h-2:graph.h-8);
  assert(path.path.commands.includes('Z'),'Guide is a closed filled rectangle');
  assert(!path.path.commands.includes('C'),'Guide has no rounded corners');
  assert(b.left>=1.5 && b.right<=graph.w-1.5 && b.bottom>=2 && b.top<=graph.h-2,'Guide stays inside every plot edge');
  for (const point of path.path) assert((point[0]===b.left || point[0]===b.right) && (point[1]===b.bottom || point[1]===b.top),'Guide has square corners without rounding');
  assert.strictEqual(new Set(path.path.map(p=>p.join(','))).size,4,'Rectangular guide has exactly four distinct corners');
  const guideIndex=graph.paths.indexOf(path),lineIndices=graph.paths.map((p,i)=>p.path.length===2?i:-1).filter(i=>i>=0),curveIndices=graph.paths.map((p,i)=>p.path.length===151?i:-1).filter(i=>i>=0);
  assert.strictEqual(lineIndices.length,12); assert(lineIndices.every(i=>i<guideIndex),'Guide overlays all grid lines and axes');
  assert(curveIndices.length>0 && curveIndices.every(i=>i>guideIndex),'All selection and Power curves overlay the guide');
  if (pressed || color!=='#434343') assertWeightLabel('midpoint');
  else assert.strictEqual(graphLabels().length,0,'Idle midpoint guide hides its value');
  assertGridAndAxes();
}
function assertGuideAtPlotEdges() {
  for (const midpoint of [.01,.99]) {
    both(midpoint); graphHost.onMouseLeave(); assertGuide('#434343');
    graphHost.onMousePress(pointerFor(midpoint),'left'); assertGuide('#c58bd0',true);
    graphHost.onMouseRelease(pointerFor(midpoint),'left'); assert.deepStrictEqual(actions.pop(),['openWeightEditor','midpoint']);
    assertGuide(selectedHandleColor()); graphHost.onMouseLeave(); assertGuide('#434343');
  }
}
assert.strictEqual(guidePath(),undefined,'Out does not show the Both guide');
s.direction='in'; updatePowerExpression(); panel.refresh(); assert.strictEqual(guidePath(),undefined,'In does not show the Both guide'); s.direction='out'; updatePowerExpression(); panel.refresh();
const initialGuideActions=actions.length,initialGuideCalls=bothCalls.length;
graphHost.onMousePress({x:220,y:50},'left'); graphHost.onMouseMove({x:300,y:50}); graphHost.onMouseRelease({x:300,y:50},'left');
assert.strictEqual(actions.length,initialGuideActions); assert.strictEqual(bothCalls.length,initialGuideCalls);
both(); assertGuide('#434343'); assert.deepStrictEqual(graphCurves().slice(0,2).map(p=>p.path),originalSelectionPaths);
let center=guideCenter(); graphHost.onMouseEnter({x:center+7,y:2}); assertGuide(selectedHandleColor()); graphHost.onMouseMove({x:center+7.01,y:graph.h}); assertGuide('#434343');
graphHost.onMouseMove({x:center,y:50}); panel.refresh(); panel.resize(graph.h+1); assertGuide(selectedHandleColor()); panel.resize(graph.h-1); graphHost.onMouseLeave(); assertGuide('#434343');
// Right-click resets only a visible Both guide, once, without opening a popup/menu.
let resetMenuShows=ui.menuShows || 0; const resetWidgetCount=widgets.length;
both(.3757); graphHost.onMousePress(pointerFor(.3757),'right'); assert.deepStrictEqual(bothCalls.pop(),[.5,true,'numeric']); near(s.bothMidpoint,.5);
assert.strictEqual(s.powerExpression,ctx.MeaseyMath.powerExpression(4,'in out',.5)); assert.strictEqual(powerField.getText(),'4'); assert.strictEqual(input.getText(),customText); assertGuide('#434343');
graphHost.onMouseRelease(pointerFor(.5),'right'); graphHost.onMouseRelease(pointerFor(.8),'left');
assert.strictEqual(actions.length,initialGuideActions); assert.strictEqual(bothCalls.length,initialGuideCalls); assert.strictEqual(ui.menuShows || 0,resetMenuShows); assert.strictEqual(widgets.length,resetWidgetCount);
center=guideCenter(); graphHost.onMousePress({x:center+8,y:50},'right'); graphHost.onMouseRelease({x:center,y:50},'right');
assert.strictEqual(ui.menuShows,resetMenuShows+1,'Empty graph right-click opens a context menu'); resetMenuShows=ui.menuShows;
graphHost.onMousePress({x:center+8,y:50},'left'); graphHost.onMouseRelease({x:center,y:50},'left');
assert.strictEqual(actions.length,initialGuideActions); assert.strictEqual(bothCalls.length,initialGuideCalls);
for (const [direction,powerSelected] of [['in',true],['out',true],['in out',false]]) {
  Object.assign(s,{direction,powerSelected,bothMidpoint:.3757}); updatePowerExpression(); panel.refresh();
  graphHost.onMousePress(pointerFor(.3757),'right'); graphHost.onMouseRelease(pointerFor(.3757),'right'); graphHost.onMouseRelease(pointerFor(.8),'left');
  near(s.bothMidpoint,.3757); assert.strictEqual(bothCalls.length,initialGuideCalls); assert.strictEqual(actions.length,initialGuideActions); assert.strictEqual(ui.menuShows,resetMenuShows+1); resetMenuShows=ui.menuShows;
}
// Reset also cancels a captured left drag, so its delayed release cannot reapply.
both(.25); graphHost.onMousePress(pointerFor(.25),'left'); graphHost.onMouseMove(pointerFor(.65)); assert.deepStrictEqual(bothCalls.pop(),[.65,false,'drag']);
graphHost.onMousePress(pointerFor(.65),'right'); assert.deepStrictEqual(bothCalls.pop(),[.5,true,'numeric']); graphHost.onMouseRelease(pointerFor(.65),'right'); graphHost.onMouseRelease(pointerFor(.8),'left');
near(s.bothMidpoint,.5); assert.strictEqual(bothCalls.length,initialGuideCalls); assert.strictEqual(actions.length,initialGuideActions); assert.strictEqual(ui.menuShows || 0,resetMenuShows);
both(.5); center=guideCenter(); graphHost.onMouseLeave();
// A click opens numeric entry only at release and never changes the value.
graphHost.onMousePress({x:center,y:50},'left'); assertGuide('#c58bd0',true); assert.strictEqual(actions.length,initialGuideActions); assert.strictEqual(bothCalls.length,initialGuideCalls);
graphHost.onMouseMove({x:center+2.999,y:80}); graphHost.onMouseRelease({x:center+2.999,y:80},'left');
assert.deepStrictEqual(actions.pop(),['openWeightEditor','midpoint']); assert.strictEqual(bothCalls.length,initialGuideCalls); near(s.bothMidpoint,.5); assertGuide(selectedHandleColor());
// Exactly3px is a drag; native press/release-only input still commits the final snapped value.
graphHost.onMousePress({x:center,y:50},'left'); graphHost.onMouseRelease({x:center+3,y:50},'left'); assert.deepStrictEqual(bothCalls.pop(),[.51,true,'drag']); assert.strictEqual(actions.length,initialGuideActions);
both(.5); center=guideCenter(); drawOffsetX=10;
// The parent is10px left of Draw, and a6px off-center grab must not jump.
graphHost.onMousePress(pointerFor(.5,6),'left'); assertGuide('#c58bd0',true); near(s.bothMidpoint,.5); assert.strictEqual(bothCalls.length,initialGuideCalls);
graphHost.onMouseMove(pointerFor(.5,6)); near(s.bothMidpoint,.5); assert.strictEqual(bothCalls.length,initialGuideCalls);
graphHost.onMouseMove(pointerFor(.7,6)); assert.deepStrictEqual(bothCalls.pop(),[.7,false,'drag']); near(s.bothMidpoint,.7);
graphHost.onMouseMove(pointerFor(.704,6)); assert.strictEqual(bothCalls.length,initialGuideCalls,'Sub-step motion does not emit duplicate preview writes');
graphHost.onMouseMove(pointerFor(.706,6)); assert.deepStrictEqual(bothCalls.pop(),[.71,false,'drag']);
graphHost.onMouseLeave(); panel.refresh(); panel.resize(graph.h+1); assertGuide('#c58bd0',true); panel.resize(graph.h-1);
graphHost.onMouseRelease(pointerFor(.8,6),'left'); assert.deepStrictEqual(bothCalls.pop(),[.8,true,'drag']); assert.strictEqual(actions.length,initialGuideActions); assertGuide(selectedHandleColor()); graphHost.onMouseLeave(); assertGuide('#434343');
drawOffsetX=0; both(.5); graphHost.onMousePress(pointerFor(.5),'left'); graphHost.onMouseRelease(pointerFor(.25),'left'); assert.deepStrictEqual(bothCalls.pop(),[.25,true,'drag']);
graphHost.onMousePress(pointerFor(.25),'left'); graphHost.onMouseRelease({x:-1000,y:50},'left'); assert.deepStrictEqual(bothCalls.pop(),[.01,true,'drag']);
graphHost.onMousePress(pointerFor(.01),'left'); graphHost.onMouseRelease({x:10000,y:50},'left'); assert.deepStrictEqual(bothCalls.pop(),[.99,true,'drag']);
assertGuideAtPlotEdges();
// Native input modal provides a real title, precise entry and Cancel without a draft window.
both(.5); const popupCalls=bothCalls.length,popupActions=actions.length,popupWidgets=widgets.length;
modalReplies.push('0,3757'); panel.openMidpointEditor(); assert.deepStrictEqual(bothCalls.pop(),[.3757,true,'numeric']); near(s.bothMidpoint,.3757);
assert.deepStrictEqual(modalCalls.at(-1),{title:'Midpoint',caption:'Adjust mid point',current:'0.5'});
assert.strictEqual(widgets.length,popupWidgets,'Native dialogs do not create secondary Container widgets');
const cancelledGraph=graph.paths.map(p=>p.path),beforeCancel=modalMessages.length;
for (const cancelled of ['',null,undefined,'   ']) { modalReplies.push(cancelled); panel.openMidpointEditor(); near(s.bothMidpoint,.3757); }
assert.strictEqual(bothCalls.length,popupCalls); assert.strictEqual(modalMessages.length,beforeCancel); assert.deepStrictEqual(graph.paths.map(p=>p.path),cancelledGraph);
for (const text of ['0','1','0.001','-0.1','0.5.2','0,5,2','NaN','1e-1']) {
  modalReplies.push(text); const before=modalMessages.length; panel.openMidpointEditor();
  assert.strictEqual(bothCalls.length,popupCalls); near(s.bothMidpoint,.3757); assert.strictEqual(modalMessages.length,before+1); assert(modalMessages.at(-1).includes('0.01 to 0.99'));
}
modalReplies.push('  ,25 '); panel.openMidpointEditor(); assert.deepStrictEqual(bothCalls.pop(),[.25,true,'numeric']); near(s.bothMidpoint,.25);
const beforeBlockedModal=modalCalls.length;
s.powerSelected=false; panel.refresh(); panel.openMidpointEditor(); assert.strictEqual(modalCalls.length,beforeBlockedModal,'Custom expression cannot open a Power midpoint editor');
s.powerSelected=true; s.direction='out'; panel.refresh(); panel.openMidpointEditor(); assert.strictEqual(modalCalls.length,beforeBlockedModal,'Out cannot open a Both midpoint editor');
assert.strictEqual(actions.length,popupActions); both(.5);
// Horizontal handles control endpoint slopes, with independent directional visibility.
const endpointActionCount=actions.length,endpointMidpointCalls=bothCalls.length;
delete s.bottom; delete s.top; updatePowerExpression(); panel.refresh(); graphHost.onMouseLeave(); assertEndpoints(['bottom','top']);
s.bottom=s.top=0;
for (const [direction,sides] of [['in',['bottom']],['out',['top']],['in out',['bottom','top']]]) { s.direction=direction; updatePowerExpression(); panel.refresh(); graphHost.onMouseLeave(); assertEndpoints(sides); }
s.powerSelected=false; panel.refresh(); assertEndpoints([]); graphHost.onMousePress(endpointPointer('bottom',0),'left'); graphHost.onMouseMove(endpointPointer('bottom',.8)); graphHost.onMouseRelease(endpointPointer('bottom',.8),'left'); graphHost.onMousePress(endpointPointer('top',0),'right'); assert.strictEqual(endpointCalls.length,0);
both(.5); graphHost.onMouseLeave(); assertEndpoints(['bottom','top']);
graphHost.onMouseEnter(endpointPointer('bottom',0,7,30)); assertEndpoints(['bottom','top'],'bottom'); graphHost.onMouseMove(endpointPointer('bottom',0,7.01,30)); assertEndpoints(['bottom','top']);
graphHost.onMouseMove(endpointPointer('top',0,0,30)); panel.refresh(); panel.resize(graph.h+1); assertEndpoints(['bottom','top'],'top'); panel.resize(graph.h-1); graphHost.onMouseLeave(); assertEndpoints(['bottom','top']);
// Endpoint hit priority prevents a click where the bars cross the midpoint from opening its editor.
graphHost.onMousePress(endpointPointer('bottom',0),'left'); assertEndpoints(['bottom','top'],null,'bottom'); graphHost.onMouseRelease(endpointPointer('bottom',0,1.999),'left'); assert.strictEqual(endpointCalls.length,0); assert.deepStrictEqual(actions.pop(),['openWeightEditor','bottom']); assert.strictEqual(actions.length,endpointActionCount);
graphHost.onMousePress(endpointPointer('bottom',0),'left'); graphHost.onMouseRelease(endpointPointer('bottom',0,2),'left'); assert.deepStrictEqual(endpointCalls.pop(),['bottom',Math.round(2/((graph.h-4)/2-14)*100)/100,true,'drag']);
s.bottom=.3; updatePowerExpression(); panel.refresh(); graphHost.onMouseLeave(); drawOffsetX=10;
const beforeEndpointCurve=graphCurves().at(-1).path;
graphHost.onMousePress(endpointPointer('bottom',.3,5),'left'); assertEndpoints(['bottom','top'],null,'bottom'); graphHost.onMouseMove(endpointPointer('bottom',.3,5)); near(s.bottom,.3); assert.strictEqual(endpointCalls.length,0,'Off-centre press does not jump');
graphHost.onMouseMove(endpointPointer('bottom',.7,5)); assert.deepStrictEqual(endpointCalls.pop(),['bottom',.7,false,'drag']); assert.notDeepStrictEqual(graphCurves().at(-1).path,beforeEndpointCurve,'Endpoint edits update the current curve'); assert.deepStrictEqual(graphCurves().slice(0,2).map(p=>p.path),originalSelectionPaths);
graphHost.onMouseMove(endpointPointer('bottom',.704,5)); assert.strictEqual(endpointCalls.length,0,'Sub-step endpoint motion avoids duplicate preview calls'); graphHost.onMouseMove(endpointPointer('bottom',.706,5)); assert.deepStrictEqual(endpointCalls.pop(),['bottom',.71,false,'drag']);
graphHost.onMouseLeave(); panel.refresh(); panel.resize(graph.h+1); assertEndpoints(['bottom','top'],null,'bottom'); panel.resize(graph.h-1); graphHost.onMouseRelease(endpointPointer('bottom',.8,5),'left'); assert.deepStrictEqual(endpointCalls.pop(),['bottom',.8,true,'drag']); graphHost.onMouseLeave(); assertEndpoints(['bottom','top']);
drawOffsetX=0; graphHost.onMousePress(endpointPointer('top',0),'left'); graphHost.onMouseRelease(endpointPointer('top',.65),'left'); assert.deepStrictEqual(endpointCalls.pop(),['top',.65,true,'drag']); near(s.top,.65,'Top slope increases by moving down in Y-up coordinates');
graphHost.onMousePress(endpointPointer('top',.65),'left'); graphHost.onMouseMove(endpointPointer('top',.7)); assert.deepStrictEqual(endpointCalls.pop(),['top',.7,false,'drag']); graphHost.onMouseRelease(undefined,'left'); assert.deepStrictEqual(endpointCalls.pop(),['top',.7,true,'drag']);
graphHost.onMousePress(endpointPointer('bottom',.8),'left'); graphHost.onMouseRelease({x:graph.w/2,y:10000},'left'); assert.deepStrictEqual(endpointCalls.pop(),['bottom',1,true,'drag']); graphHost.onMousePress(endpointPointer('bottom',1),'left'); graphHost.onMouseRelease({x:graph.w/2,y:-10000},'left'); assert.deepStrictEqual(endpointCalls.pop(),['bottom',0,true,'drag']);
graphHost.onMousePress(endpointPointer('top',.7),'left'); graphHost.onMouseRelease({x:graph.w/2,y:-10000},'left'); assert.deepStrictEqual(endpointCalls.pop(),['top',1,true,'drag']); graphHost.onMousePress(endpointPointer('top',1),'right'); assert.deepStrictEqual(endpointCalls.pop(),['top',0,true,'numeric']); graphHost.onMouseRelease(endpointPointer('top',0),'right'); graphHost.onMouseRelease(endpointPointer('top',.8),'left'); assert.strictEqual(endpointCalls.length,0,'Right-reset release does not duplicate a write');
graphHost.onMousePress(endpointPointer('bottom',0,0,-50),'right'); graphHost.onMouseRelease(endpointPointer('bottom',0),'right'); assert.strictEqual(endpointCalls.length,0,'Outside the bar width is inactive');
s.direction='out'; updatePowerExpression(); panel.refresh(); graphHost.onMousePress(endpointPointer('bottom',0),'right'); graphHost.onMouseRelease(endpointPointer('bottom',.8),'left'); assert.strictEqual(endpointCalls.length,0,'Out cannot adjust Bottom');
s.direction='in'; updatePowerExpression(); panel.refresh(); graphHost.onMousePress(endpointPointer('top',0),'right'); graphHost.onMouseRelease(endpointPointer('top',.8),'left'); assert.strictEqual(endpointCalls.length,0,'In cannot adjust Top');
both(.5); graphHost.onMousePress(endpointPointer('bottom',0),'left'); graphHost.onMouseMove(endpointPointer('bottom',.6)); assert.deepStrictEqual(endpointCalls.pop(),['bottom',.6,false,'drag']); directionControls[2].onClick(); graphHost.onMouseRelease(endpointPointer('bottom',.8),'left'); assert.strictEqual(endpointCalls.length,0,'Changing direction cancels an inactive captured endpoint');
both(.5); s.bottom=s.top=1; updatePowerExpression(); panel.refresh(); graphHost.onMouseLeave(); assertEndpoints(['bottom','top']); near(endpointCentre('top')-endpointCentre('bottom'),12);
graphHost.onMousePress({x:guideCenter(),y:graph.h/2},'left'); graphHost.onMouseRelease({x:guideCenter(),y:graph.h/2},'left'); assert.deepStrictEqual(actions.pop(),['openWeightEditor','midpoint']); assert.strictEqual(endpointCalls.length,0,'The central strip still opens Midpoint when both endpoints are maximal');
assert.strictEqual(actions.length,endpointActionCount); assert.strictEqual(bothCalls.length,endpointMidpointCalls); assert.strictEqual(input.getText(),customText);
s.bottom=s.top=0; both(.5); graphHost.onMouseLeave();
// Exercise real controller routing through release, native modal and call()->refresh.
const logOnlyWeightEditor=controller.openWeightEditor;
controller.openWeightEditor=function(kind) { actions.push(['openWeightEditor',kind]); panel.openWeightEditor(kind); };
for (const [kind,direction] of [['bottom','in'],['top','out'],['midpoint','in out']]) {
  Object.assign(s,{bottom:0,top:0,bothMidpoint:.5,direction,powerSelected:true}); updatePowerExpression(); panel.refresh(); graphHost.onMouseLeave();
  const point=kind==='midpoint'?{x:guideCenter(),y:graph.h/2}:endpointPointer(kind,0),beforeWidgets=widgets.length;
  modalReplies.push('0,3757'); graphHost.onMousePress(point,'left'); graphHost.onMouseRelease(point,'left');
  assert.deepStrictEqual(actions.pop(),['openWeightEditor',kind]);
  const title=kind==='midpoint'?'Midpoint':kind==='bottom'?'Bottom weight':'Top weight';
  assert.deepStrictEqual(modalCalls.at(-1),{title,caption:kind==='midpoint'?'Adjust mid point':title,current:kind==='midpoint'?'0.5':'0'});
  if (kind==='midpoint') { assert.deepStrictEqual(bothCalls.pop(),[.3757,true,'numeric']); near(s.bothMidpoint,.3757); }
  else { assert.deepStrictEqual(endpointCalls.pop(),[kind,.3757,true,'numeric']); near(s[kind],.3757); }
  assert.strictEqual(widgets.length,beforeWidgets,'A click uses the native modal and keeps graph sliders in place');
  modalReplies.push(''); const beforeEndpoints=endpointCalls.length,beforeBoth=bothCalls.length;
  graphHost.onMousePress(kind==='midpoint'?pointerFor(.3757):endpointPointer(kind,.3757),'left'); graphHost.onMouseRelease(kind==='midpoint'?pointerFor(.3757):endpointPointer(kind,.3757),'left');
  assert.deepStrictEqual(actions.pop(),['openWeightEditor',kind]); assert.strictEqual(endpointCalls.length,beforeEndpoints); assert.strictEqual(bothCalls.length,beforeBoth);
  for (const invalid of ['-0.01','1.01','NaN','0.2.3']) { const before=modalMessages.length; modalReplies.push(invalid); panel.openWeightEditor(kind); assert.strictEqual(modalMessages.length,before+1); assert.strictEqual(endpointCalls.length,beforeEndpoints); assert.strictEqual(bothCalls.length,beforeBoth); }
  if (kind!=='midpoint') for (const value of ['0','1']) { modalReplies.push(value); panel.openWeightEditor(kind); assert.deepStrictEqual(endpointCalls.pop(),[kind,Number(value),true,'numeric']); }
}
controller.openWeightEditor=logOnlyWeightEditor;
// Modal result cannot apply to a handle that became inactive during the native nested loop.
both(.5); modalReplies.push(()=>{s.direction='out';panel.refresh();return '.8';}); panel.openWeightEditor('bottom'); assert.strictEqual(endpointCalls.length,0); near(s.bottom,0);
// The empty-graph menu resets all weights and cancels captured drags atomically.
Object.assign(s,{power:6,direction:'in out',bothMidpoint:.32,bottom:.45,top:.65}); updatePowerExpression(); panel.refresh();
const beforeWeightsMenu=ui.menuShows || 0,emptyGraphPoint={x:25,y:graph.h/2}; graphHost.onMousePress(emptyGraphPoint,'right');
assert.strictEqual(ui.menuShows,beforeWeightsMenu+1); assert.strictEqual(ui.menu.length,1); assert.strictEqual(ui.menu[0].name,'Reset Weights');
assert.strictEqual(endpointCalls.length,0); assert.strictEqual(bothCalls.length,endpointMidpointCalls); near(s.bottom,.45); near(s.top,.65); near(s.bothMidpoint,.32);
const resetWeightsItem=ui.menu[0]; s.direction='out'; updatePowerExpression(); panel.refresh(); resetWeightsItem.onMouseRelease(); assert.deepStrictEqual(actions.pop(),['resetWeights']);
near(s.bottom,0); near(s.top,0); near(s.bothMidpoint,.5); assert.strictEqual(s.power,6); assert.strictEqual(s.direction,'out'); assert.strictEqual(input.getText(),customText);
both(.5); graphHost.onMousePress({x:guideCenter(),y:graph.h/2},'left'); graphHost.onMouseMove(pointerFor(.65)); assert.deepStrictEqual(bothCalls.pop(),[.65,false,'drag']); graphHost.onMousePress(emptyGraphPoint,'right'); graphHost.onMouseRelease(pointerFor(.8),'left'); assert.strictEqual(bothCalls.length,endpointMidpointCalls,'Opening the menu cancels captured midpoint movement');
both(.5); graphHost.onMousePress(endpointPointer('bottom',0),'left'); graphHost.onMouseMove(endpointPointer('bottom',.6)); assert.deepStrictEqual(endpointCalls.pop(),['bottom',.6,false,'drag']); graphHost.onMousePress(emptyGraphPoint,'right'); graphHost.onMouseRelease(endpointPointer('bottom',.8),'left'); assert.strictEqual(endpointCalls.length,0,'Opening the menu cancels captured endpoint movement');
s.bottom=s.top=0; both(.5); graphHost.onMouseLeave();
// Release without a coordinate commits the already-previewed value once.
both(.5); graphHost.onMousePress(pointerFor(.5),'left'); graphHost.onMouseMove(pointerFor(.6)); assert.deepStrictEqual(bothCalls.pop(),[.6,false,'drag']); graphHost.onMouseRelease(undefined,'left'); assert.deepStrictEqual(bothCalls.pop(),[.6,true,'drag']);
// Changing direction cancels a captured drag and suppresses its delayed release.
both(.5); graphHost.onMousePress(pointerFor(.5),'left'); graphHost.onMouseMove(pointerFor(.6)); assert.deepStrictEqual(bothCalls.pop(),[.6,false,'drag']); directionControls[2].onClick(); assert.strictEqual(guidePath(),undefined); graphHost.onMouseRelease(pointerFor(.8),'left'); assert.strictEqual(bothCalls.length,initialGuideCalls); assert.strictEqual(actions.length,initialGuideActions);
s.direction='out'; s.power=1; updatePowerExpression(); panel.refresh(); assert.strictEqual(guidePath(),undefined); assert.strictEqual(input.getText(),customText,'Guide edits do not overwrite the custom expression');
assert.strictEqual(input.background,powerField.background);
for (const [text,action] of [['≈','flatten'],['×','clear'],['→','getSelection'],['✓','apply'],['⚙','showSettings'],['⋯','showLibrarySettings']]) { widgets.find(w=>w.kind==='Button' && w.value===text).onClick(); assert.deepStrictEqual(actions.pop(),[action]); }
const applyLabel=widgets.find(w=>w.kind==='Label' && w.value==='Apply'),applyControl=widgets.find(w=>w.kind==='Container' && w.layout && w.layout.children.includes(applyLabel));
assert(applyControl); assert.strictEqual(applyControl.fixedHeight,28); assert.deepStrictEqual(applyControl.radius,[3,3,3,3]); assert.strictEqual(applyLabel.alignment,1); assert.strictEqual(applyControl.background,'#c58bd0');
applyControl.onMouseRelease({},'right'); assert.strictEqual(actions.length,0); applyControl.onMouseRelease({},'left'); assert.deepStrictEqual(actions.pop(),['applyPower']);
s.canApplyPower=false; s.status='Curve already matches'; panel.refresh(); assert.strictEqual(applyControl.background,'#434343'); assert.strictEqual(applyLabel.value,'Applied'); assert.strictEqual(applyLabel.textColor,libraryHeading.textColor);
const actionCount=actions.length; applyControl.onMouseRelease({},'left'); assert.strictEqual(actions.length,actionCount,'Applied performs no scene operation');
s.selectedPowerLevels=[]; panel.refresh(); assert.strictEqual(applyLabel.value,'Apply','An empty selection is not labeled Applied'); s.selectedPowerLevels=[1,2,3,4,1.539,'?'];
assert(input.tooltip.includes(s.status)); assert(graph.tooltip.includes(s.status)); assert(!widgets.some(w=>w.kind==='Label' && /Curve already matches/.test(w.value || '')));
const libraryButton=widgets.find(w=>w.kind==='Button' && w.value==='⋯'); assert.strictEqual(libraryButton.background,ui.background);
// Simulate a large dock, then shrink the root before stale child allocations catch up.
allocated.graph=allocated.slider=allocated.divider=700; dimensions={width:1000,height:700}; panel.resize(); assert.strictEqual(graph.w,700); assert.strictEqual(sliderCanvas.w,700);
dimensions={x:220,y:260}; panel.resize(700); for (const canvas of [graph,sliderCanvas,dividerCanvas]) assert.strictEqual(canvas.w,204,'Stale allocated widths are capped at root width minus margins');
assert.strictEqual(graph.h,700); assert.strictEqual(graph.minWidth,160); assert.strictEqual(sliderCanvas.minWidth,0); assert.strictEqual(dividerCanvas.minWidth,0); for (const host of [graphHost,slider,divider]) assert.strictEqual(host.maxWidth,204);
assertGuideAtPlotEdges();
const callsBeforeDeferred=powerCalls.length; allocated.graph=180; allocated.slider=176; allocated.divider=180; layoutTimer.tick(); assert.strictEqual(graph.w,180); assert.strictEqual(sliderCanvas.w,176); assert.strictEqual(dividerCanvas.w,180); assert.strictEqual(powerCalls.length,callsBeforeDeferred,'Deferred docking updates without slider interaction');
assertGuideAtPlotEdges();
const deferredResizes=resizes,deferredDraws=redraws; layoutTimer.tick(); assert.strictEqual(resizes,deferredResizes); assert.strictEqual(redraws,deferredDraws);
panel.resize(20); assert.strictEqual(graph.h,120); assert.strictEqual(ui.root.fixedHeight,undefined);
dimensions={x:176,y:260}; layoutTimer.tick(); assert.strictEqual(graph.w,160,'Guide also fits the minimum graph width'); assertGuideAtPlotEdges();
s.bottom=s.top=1; updatePowerExpression(); panel.refresh(); graphHost.onMouseLeave(); assertEndpoints(['bottom','top']); graphHost.onMousePress(endpointPointer('bottom',1),'left'); assertEndpoints(['bottom','top'],null,'bottom'); graphHost.onMouseRelease(endpointPointer('bottom',1),'left'); assert.deepStrictEqual(actions.pop(),['openWeightEditor','bottom']); assert.strictEqual(endpointCalls.length,0); s.bottom=s.top=0; updatePowerExpression(); panel.refresh();
s.libraryName='A long library name that cannot fit inside the minimum panel'; panel.refresh(); assert(libraryName.value.endsWith('…')); assert.strictEqual(libraryName.tooltip,s.libraryName); assert.strictEqual(libraryHeading.fixedHeight,18);
presets=[{id:'mine',name:'CUSTOM',type:'in out',expression:'pow(x,3)'}]; panel.layoutChanged(); assert(widgets.some(w=>w.kind==='Label' && w.value==='CUSTOM'));
const presetHost=widgets.filter(w=>w.kind==='Container' && /^CUSTOM in out\n/.test(w.tooltip || '')).at(-1);
const beforePresetMenu=ui.menuShows || 0; presetHost.onMousePress({},'right'); assert.strictEqual(ui.menuShows,beforePresetMenu+1); assert.strictEqual(ui.menu.length,1); assert.strictEqual(ui.menu[0].name,'Delete Preset'); ui.menu[0].onMouseRelease(); assert.deepStrictEqual(actions.pop(),['deletePreset','mine']);
presetHost.onMousePress({},'left'); assert.deepStrictEqual(actions.pop(),['selectPreset','mine']);
s.layout='list'; panel.layoutChanged(); s.mode='speed'; s.selectionPreviewCurves=[{samples:[{x:0,y:0},{x:.5,y:.1},{x:1,y:1}]}]; panel.refresh(); assert.strictEqual(graphCurves().length,2);
s.selectionPreviewCurves=[{bezier:[.25,.1,.25,1]}]; panel.refresh(); assert.strictEqual(graphCurves().length,2); assert.strictEqual(graphCurves().at(-1).paint.color,'#c58bd0');
s.expression=''; s.nativeMagic=true; panel.refresh(); assert.strictEqual(input.placeholder,'Native Magic Easing — type to replace'); s.nativeMagic=false; s.mixed=true; s.customMixed=false; panel.refresh(); assert.strictEqual(input.placeholder,'Magic expression, e.g. x^3'); s.customMixed=true; panel.refresh(); assert.strictEqual(input.placeholder,'Mixed expressions — type to replace selected easing');
s.direction='out'; updatePowerExpression(); s.selectionPreviewCurves=[{expression:'x^'}]; panel.refresh(); assert.strictEqual(graphCurves().length,1,'Current Power remains visible when a selected formula cannot be previewed'); assert(!graph.paths.some(p=>p.path.texts && p.path.texts.length),'Out displays no midpoint text');
// Large repeated selections compile/sample once and reuse paths across pointer paints.
const savedPerformanceState={...s},savedPerformancePresets=presets;
presets=[]; Object.assign(s,{power:5.25,powerSelected:true,direction:'out',mode:'value',bottom:0,top:0,bothMidpoint:.5}); updatePowerExpression();
const previewKinds=[{expression:'pow(x, 2.125)'},{expression:'x^2.125'},{expression:'pow(x, 3.125)'},{samples:[{x:0,y:0},{x:.5,y:.2},{x:1,y:1}]},{samples:[{x:0,y:0},{x:.5,y:.2},{x:1,y:1}]}];
s.selectionPreviewCurves=Array.from({length:5000},(_,i)=>previewKinds[i%previewKinds.length]);
const beforeLargeCompile=compileCalls,beforeLargeState=stateReads;
panel.refresh(); graphHost.onMouseLeave();
assert.strictEqual(stateReads,beforeLargeState+1,'A refresh obtains controller state exactly once');
assert(compileCalls-beforeLargeCompile<=4,'Five thousand repeated keys compile only their distinct expressions');
assert.strictEqual(graphCurves().length,4,'Expression aliases and identical sampled curves draw once; every distinct geometry remains');
const cachedSelectedPaths=graphCurves().map(p=>p.path),beforeHover={stateReads,compileCalls,evaluations,curvePathBuilds};
for (let i=0;i<30;i++) { graphHost.onMouseEnter(endpointPointer('top',0)); graphHost.onMouseMove({x:15,y:graph.h/2}); graphHost.onMouseLeave(); }
assert.strictEqual(stateReads,beforeHover.stateReads,'Hover helpers use the captured state');
assert.strictEqual(compileCalls,beforeHover.compileCalls); assert.strictEqual(evaluations,beforeHover.evaluations,'Hover does not evaluate easing samples');
assert.strictEqual(curvePathBuilds,beforeHover.curvePathBuilds,'Hover reuses all curve path objects');
assert(graphCurves().every((p,i)=>p.path===cachedSelectedPaths[i]),'Pointer updates reuse the active scene paths');
const repeatedState=stateReads; panel.refresh(); assert.strictEqual(stateReads,repeatedState+1); assert.strictEqual(evaluations,beforeHover.evaluations);
s.selectionPreviewCurves=s.selectionPreviewCurves.map(c=>c.expression?{expression:c.expression}:{samples:c.samples.map(p=>({...p}))});
panel.refresh(); assert.strictEqual(compileCalls,beforeHover.compileCalls); assert.strictEqual(evaluations,beforeHover.evaluations,'A new equivalent selection snapshot reuses sample data');
assert(graphCurves().every((p,i)=>p.path===cachedSelectedPaths[i]));
const beforeGraphResize={compileCalls,evaluations,curvePathBuilds}; panel.resize(graph.h+1);
assert.strictEqual(compileCalls,beforeGraphResize.compileCalls); assert.strictEqual(evaluations,beforeGraphResize.evaluations,'Resizing changes paths without resampling curves');
assert(curvePathBuilds>beforeGraphResize.curvePathBuilds); panel.resize(graph.h-1);
s.mode='speed'; panel.refresh(); const speedEvaluations=evaluations; assert(speedEvaluations>beforeHover.evaluations);
s.mode='value'; panel.refresh(); s.mode='speed'; panel.refresh(); assert.strictEqual(evaluations,speedEvaluations,'Value and Speed samples are cached separately');
s.mode='value'; s.selectionPreviewCurves=[{expression:'pow(x, 2.375)'}]; panel.refresh(); const previousSelected=graphCurves()[0].path,previousSamples=evaluations;
s.selectionPreviewCurves[0].expression='pow(x, 2.625)'; panel.refresh(); assert(evaluations>previousSamples,'Changing an existing descriptor invalidates its samples'); assert.notDeepStrictEqual(graphCurves()[0].path,previousSelected);
const beforeInvalid=compileCalls; s.selectionPreviewCurves=[{expression:'x + ?'}]; panel.refresh(); assert.strictEqual(compileCalls,beforeInvalid+1); assert.strictEqual(graphCurves().length,1);
for (let i=0;i<5;i++) { s.selectionPreviewCurves=[{expression:'x + ?'}]; panel.refresh(); graphHost.onMouseEnter(endpointPointer('top',0)); graphHost.onMouseLeave(); }
assert.strictEqual(compileCalls,beforeInvalid+1,'Invalid formulas are cached without repeated compiler work');
// Do not silently cap a selection with many genuinely distinct curves.
s.selectionPreviewCurves=Array.from({length:320},(_,i)=>({expression:'pow(x, '+(2+i/1000)+')'})); panel.refresh(); graphHost.onMouseLeave();
assert.strictEqual(graphCurves().length,321,'All320 distinct grey shapes plus current Power are retained');
const manyWarm={compileCalls,evaluations,curvePathBuilds}; graphHost.onMouseEnter(endpointPointer('top',0)); graphHost.onMouseLeave();
assert.strictEqual(compileCalls,manyWarm.compileCalls); assert.strictEqual(evaluations,manyWarm.evaluations); assert.strictEqual(curvePathBuilds,manyWarm.curvePathBuilds,'Active scene paths remain reusable even above historical cache limits');
// Historical caches evict old expressions instead of retaining every edited Power.
s.selectionPreviewCurves=[]; s.power=7.001; updatePowerExpression(); panel.refresh();
for (let i=0;i<300;i++) { s.power=8+i/1000; updatePowerExpression(); panel.refresh(); }
const afterCacheChurn=compileCalls; s.power=7.001; updatePowerExpression(); panel.refresh(); assert.strictEqual(compileCalls,afterCacheChurn+1,'Bounded caches evict an old compiled expression');
Object.assign(s,savedPerformanceState); presets=savedPerformancePresets; updatePowerExpression(); panel.refresh();
assert(!nativeEvents.some(e=>e.type==='popover' || e.type==='show'),'Handle editing never uses a secondary Container opening path');
// Layout changes read separately computed preferences, not a shared mutable state object.
const sharedStateGetter=controller.getState;
const layoutPreferences={layout:'list',libraryName:'Computed library',graphHeight:253};
controller.getState=function() { stateReads++; return {...s,...layoutPreferences}; };
let beforeLayoutState=stateReads; panel.layoutChanged();
assert.strictEqual(stateReads,beforeLayoutState+1,'Layout change fetches exactly one new state snapshot'); assert.strictEqual(graph.h,253); assert.strictEqual(libraryName.tooltip,'Computed library');
function latestPresetHost() { return widgets.filter(w=>w.kind==='Container' && !w.deleted && /^CUSTOM in out\n/.test(w.tooltip || '')).at(-1); }
assert.strictEqual(latestPresetHost().fixedHeight,37,'Computed list preference is used');
Object.assign(layoutPreferences,{layout:'grid',libraryName:'Switched library',graphHeight:321}); beforeLayoutState=stateReads; panel.layoutChanged();
assert.strictEqual(stateReads,beforeLayoutState+1); assert.strictEqual(graph.h,321); assert.strictEqual(libraryName.tooltip,'Switched library'); assert.notStrictEqual(latestPresetHost().fixedHeight,37,'New grid preference rebuilds the library');
layoutPreferences.graphHeight=377; panel.resize(377); layoutPreferences.libraryName='Library after resize'; beforeLayoutState=stateReads; panel.layoutChanged();
assert.strictEqual(stateReads,beforeLayoutState+1); assert.strictEqual(graph.h,377,'A layout change does not restore an old cached graph height'); assert.strictEqual(libraryName.tooltip,'Library after resize','Library name refreshes even when dimensions do not change');
controller.getState=sharedStateGetter; panel.layoutChanged();
both(.5); graphHost.onMousePress(pointerFor(.5),'left'); graphHost.onMouseMove(pointerFor(.6)); assert.deepStrictEqual(bothCalls.pop(),[.6,false,'drag']);
modalReplies.push(''); panel.openMidpointEditor();
graphHost.onMousePress(endpointPointer('bottom',0),'left'); graphHost.onMouseMove(endpointPointer('bottom',.6)); assert.deepStrictEqual(endpointCalls.pop(),['bottom',.6,false,'drag']);
const editsBeforeClose=edits,drawsBeforeClose=redraws,actionsBeforeClose=actions.length,bothBeforeClose=bothCalls.length,powerBeforeClose=powerCalls.length,endpointBeforeClose=endpointCalls.length;
panel.onClose(); const readsAtClose=stateReads; panel.layoutChanged(); assert.strictEqual(stateReads,readsAtClose,'Closed layout changes do not fetch state'); assert.strictEqual(layoutTimer.running,false); assert.strictEqual(layoutTimer.stopped,true); layoutTimer.tick(); input.onValueChanged(); panel.refresh(); panel.resize();
resetWeightsItem.onMouseRelease();
const closedModals=modalCalls.length; panel.openMidpointEditor(); panel.openWeightEditor('top'); assert.strictEqual(modalCalls.length,closedModals);
for (const host of [graphHost,divider]) {
  host.onMouseEnter({x:100,y:4}); host.onMouseLeave(); host.onMousePress({x:100,y:4},'left'); host.onMouseMove({x:180,y:4}); host.onMouseRelease({x:180,y:4},'left');
}
divider.onMouseDoubleClick({x:100,y:4},'left'); slider.onMousePress({x:100,y:4},'left'); slider.onMouseMove({x:180,y:4}); slider.onMouseRelease({x:180,y:4},'left');
assert.strictEqual(edits,editsBeforeClose); assert.strictEqual(actions.length,actionsBeforeClose); assert.strictEqual(bothCalls.length,bothBeforeClose); assert.strictEqual(powerCalls.length,powerBeforeClose); assert.strictEqual(endpointCalls.length,endpointBeforeClose); assert.strictEqual(redraws,drawsBeforeClose,'Closed graph/divider/guide/endpoints ignore all later mouse events');
console.log('Mock UI event smoke passed: layout, custom/Power states, handle geometry and conditional value labels, drag/capture/reset, routed handle editors surviving refresh, native numeric dialogs/cancellation/validation, soft slider maximum and decimal callback order, bounded preview caches/deduplication/invalidation, Reset Weights menus, docking, and closed-panel lifecycle.');
