/* Measey 1.6.3 — preview only the first ten selected keyframes. */
(function () {
    'use strict';
    var VERSION = '1.6.3', PREVIEW_LIMIT = 10, PREF = 'measey.preferences.v1', LIBS = 'measey.libraries.v1';
    var preferences = {defaultsVersion:130,autoApply:false,applyOnDrag:false,applyOnDirection:false,syncExpression:true,powerSelected:true,layout:'grid', graphHeight:235, mode:'value',power:4,bothMidpoint:0.5,bottom:0,top:0,direction:'out',customExpression:'x'};
    var libraries = [], libraryIndex = 0, panel = null, busy = false, closed = false;
    var state = {expression:'x', status:'Select keyframes to preview their outgoing easing.', previewCurves:[], selectionPreviewCurves:[], selectedPowerLevels:[], selectedPreset:null};
    var selection = null, selectionLayers=Object.create(null), selectionIdentity = '', pendingSelection = '', pendingKind = '', draft = false, lastAppliedCustom = null,lastSyncedExpression=null,lastSyncedSelection='';
    // Cache by exact source text, including rejected custom formulas. Selection
    // snapshots stay fresh; only pure expression work survives a reread.
    function boundedCache(limit) {
        var entries=Object.create(null),order=[],characters=0;
        return {
            has:function(key){return Object.prototype.hasOwnProperty.call(entries,key);},
            get:function(key){return entries[key];},
            put:function(key,value){
                if(key.length>262144)return value;
                if(!Object.prototype.hasOwnProperty.call(entries,key)){order.push(key);characters+=key.length;}
                entries[key]=value;
                while(order.length>limit||characters>262144){var old=order.shift();characters-=old.length;delete entries[old];}
                return value;
            }
        };
    }
    var compiledCache=boundedCache(256),detectionCache=boundedCache(256),matchCache=boundedCache(256);
    var generatedKey='',generatedValue='',applySnapshot=null,applyExpression='',applyClear=false,applyNeeded=false;
    function compiledExpression(expression) {
        if(compiledCache.has(expression))return compiledCache.get(expression);
        return compiledCache.put(expression,MeaseyMath.compile(expression));
    }
    function detectedPower(expression) {
        if(detectionCache.has(expression))return detectionCache.get(expression);
        var detected=null;
        if(typeof MeaseyMath.detectPower==='function')try{detected=MeaseyMath.detectPower(expression);}catch(e){}
        return detectionCache.put(expression,detected);
    }
    function safeLoad(key) { try { return api.hasPreferenceObject(key) ? api.getPreferenceObject(key) : null; } catch(e) { return null; } }
    var loaded = safeLoad(PREF);
    if (loaded && typeof loaded === 'object') {
        if (loaded.defaultsVersion === 130 && typeof loaded.autoApply === 'boolean') preferences.autoApply = loaded.autoApply;
        if (loaded.defaultsVersion === 130 && typeof loaded.applyOnDrag === 'boolean') preferences.applyOnDrag = loaded.applyOnDrag;
        if (typeof loaded.applyOnDirection === 'boolean') preferences.applyOnDirection=loaded.applyOnDirection;
        if (typeof loaded.syncExpression === 'boolean') preferences.syncExpression=loaded.syncExpression;
        if (typeof loaded.powerSelected === 'boolean') preferences.powerSelected=loaded.powerSelected;
        if (loaded.layout === 'list' || loaded.layout === 'grid') preferences.layout = loaded.layout;
        if (typeof loaded.graphHeight === 'number' && isFinite(loaded.graphHeight)) preferences.graphHeight = Math.max(120,loaded.graphHeight);
        if (loaded.mode === 'speed') preferences.mode = 'speed';
        if (typeof loaded.power === 'number' && isFinite(loaded.power) && loaded.power>=1) preferences.power=loaded.power;
        if (typeof loaded.bothMidpoint === 'number' && isFinite(loaded.bothMidpoint) && loaded.bothMidpoint>=0.01 && loaded.bothMidpoint<=0.99) preferences.bothMidpoint=loaded.bothMidpoint;
        ['bottom','top'].forEach(function(side){if(typeof loaded[side]==='number'&&isFinite(loaded[side])&&loaded[side]>=0&&loaded[side]<=1)preferences[side]=loaded[side];});
        if (['in','out','in out'].indexOf(loaded.direction)>=0) preferences.direction=loaded.direction;
        if (typeof loaded.customExpression === 'string' && loaded.customExpression.length<=12000) preferences.customExpression=loaded.customExpression;
    }
    function generatedExpression(){
        var key=[preferences.power,preferences.direction,preferences.bothMidpoint,preferences.bottom,preferences.top].join('|');
        if(key!==generatedKey){generatedValue=MeaseyMath.powerExpression(preferences.power,preferences.direction,preferences.bothMidpoint,preferences.bottom,preferences.top);generatedKey=key;}
        return generatedValue;
    }
    function requestedExpression(){return state.powerSelected?generatedExpression():(state.customCurveExpression||'');}
    function recogniseExpression(expression) {
        var check=MeaseyMath.validate(expression,128),detected=null,changes={powerSelected:false};
        state.customCurveExpression=check.ok?check.expression:'';
        if(check.ok)detected=detectedPower(expression);
        if(detected){
            changes.power=detected.power;changes.direction=detected.direction;changes.powerSelected=true;
            if(detected.direction==='in out')changes.bothMidpoint=detected.midpoint===undefined?0.5:detected.midpoint;
            if(detected.direction!=='out')changes.bottom=detected.bottom===undefined?0:detected.bottom;
            if(detected.direction!=='in')changes.top=detected.top===undefined?0:detected.top;
        }
        state.powerSelected=changes.powerSelected;savePrefs(changes);
        return check;
    }
    function syncGeneratedExpression(){
        state.powerSelected=true;savePrefs({powerSelected:true});
        if(!preferences.syncExpression)return;
        state.expression=generatedExpression();state.customCurveExpression=state.expression;state.error=false;state.nativeMagic=false;state.customMixed=false;
        // A generated field update must not be treated as a later typing commit.
        savePrefs({customExpression:state.expression});lastAppliedCustom=state.expression;lastSyncedExpression=state.expression;lastSyncedSelection=selectionToken();
    }
    state.expression=loaded&&typeof loaded.customExpression==='string'?preferences.customExpression:generatedExpression();
    preferences.customExpression=state.expression;state.powerSelected=preferences.powerSelected;
    var initialCheck=MeaseyMath.validate(state.expression,128);state.customCurveExpression=initialCheck.ok?initialCheck.expression:'';
    if(loaded&&typeof loaded.customExpression==='string'&&typeof loaded.powerSelected!=='boolean')recogniseExpression(state.expression);
    state.activeExpression=requestedExpression();state.previewCurves=state.activeExpression?[{expression:state.activeExpression}]:[];
    // Evaluated comparisons recognize equivalent syntax, including x^3 and pow(x,3).
    // Irregular probes avoid the regular-grid aliases common with trigonometry.
    function expressionsMatch(a,b) {
        if(typeof a!=='string'||typeof b!=='string'||!a.trim()||!b.trim())return false;
        if(a===b)return true;
        var key=JSON.stringify(a<b?[a,b]:[b,a]);
        if(matchCache.has(key))return matchCache.get(key);
        try {
            var first=compiledExpression(a),second=compiledExpression(b);
            if(first.expression===second.expression)return matchCache.put(key,true);
            // Include both shortest allowed midpoint branches. One opposite
            // endpoint can be linear while the narrow branch still differs.
            var probes=[0,1,0.00037,0.00157,0.00371,0.00813,0.0157,0.0371,0.0813,0.1297,0.1741,0.2339,0.2917,0.3593,0.4171,0.5,0.5639,0.6293,0.6831,0.7499,0.8173,0.8731,0.9317,0.9739,0.99187,0.99629,0.99843,0.99963];
            for(var i=0;i<probes.length;i++) {
                var x=first(probes[i]),y=second(probes[i]);
                if(!isFinite(x)||!isFinite(y)||Math.abs(x-y)>1e-9*Math.max(1,Math.abs(x),Math.abs(y)))return matchCache.put(key,false);
            }
            return matchCache.put(key,true);
        }catch(e){return matchCache.put(key,false);}
    }
    function powerNeedsApply() {
        if(!selection||!selection.count||!selection.keys||!selection.keys.length)return false;
        var expression=requestedExpression();if(!expression)return false;
        var clearRequested=state.powerSelected&&preferences.power===1;
        if(applySnapshot===selection&&applyExpression===expression&&applyClear===clearRequested)return applyNeeded;
        var silver=MeaseyHost.colors?MeaseyHost.colors.clear:16,plum=MeaseyHost.colors?MeaseyHost.colors.magic:11;
        applyNeeded=selection.keys.some(function(key) {
            var magic=key.magic||{},data=key.data||{};
            if(clearRequested)return !!magic.active||data.colorId!==silver;
            return data.colorId!==plum||!magic.active||data.interpolation===2||!expressionsMatch(magic.expression||'',expression);
        });
        applySnapshot=selection;applyExpression=expression;applyClear=clearRequested;
        return applyNeeded;
    }
    function selectedPower(key) {
        var magic=key.magic||{};
        if(!magic.active)return 1;
        if(!magic.expression||typeof MeaseyMath.detectPower!=='function')return '?';
        var detected=detectedPower(magic.expression);
        return detected&&typeof detected.power==='number'&&isFinite(detected.power)?detected.power:'?';
    }
    function normaliseLibrary(raw) {
        if (!raw || typeof raw.name !== 'string' || !Array.isArray(raw.presets)) return null;
        var result = {name:raw.name.trim().slice(0,60)||'UNTITLED',presets:[]};
        raw.presets.slice(0,500).forEach(function(p,i) {
            if (!p || typeof p.name !== 'string' || typeof p.expression !== 'string') return;
            var check = MeaseyMath.validate(p.expression,96);
            if (!check.ok) return;
            var type=typeof p.type==='string'?p.type.toLowerCase().trim().slice(0,15):'';
            var power=typeof p.power==='number'&&isFinite(p.power)&&p.power>=1&&['in','out','in out'].indexOf(type)>=0?p.power:undefined;
            var midpoint=type==='in out'?(p.bothMidpoint===undefined?0.5:p.bothMidpoint):undefined;
            var bottom=p.bottom===undefined?0:p.bottom,top=p.top===undefined?0:p.top;
            if(type==='in out'&&(typeof midpoint!=='number'||!isFinite(midpoint)||midpoint<0.01||midpoint>0.99))power=undefined;
            if(typeof bottom!=='number'||!isFinite(bottom)||bottom<0||bottom>1||typeof top!=='number'||!isFinite(top)||top<0||top>1)power=undefined;
            if(power!==undefined&&!expressionsMatch(MeaseyMath.powerExpression(power,type,midpoint,bottom,top),check.expression))power=undefined;
            result.presets.push({id:'custom-'+i,name:p.name.toUpperCase().slice(0,40),type:type,expression:check.expression,clear:p.clear===true,power:power,bothMidpoint:power!==undefined&&type==='in out'?midpoint:undefined,bottom:power!==undefined?bottom:undefined,top:power!==undefined?top:undefined});
        });
        return result;
    }
    var savedLibs = safeLoad(LIBS);
    if (savedLibs && Array.isArray(savedLibs.libraries)) savedLibs.libraries.slice(0,50).forEach(function(raw) { var lib=normaliseLibrary(raw); if(lib) libraries.push(lib); });
    if(savedLibs&&typeof savedLibs.activeIndex==='number'&&savedLibs.activeIndex>=0&&savedLibs.activeIndex<libraries.length)libraryIndex=Math.floor(savedLibs.activeIndex);
    if(!libraries.length)libraries.push({name:'MY LIBRARY',presets:[]});
    function savePrefs(change) {
        if(change) Object.keys(change).forEach(function(k) { if(Object.prototype.hasOwnProperty.call(preferences,k)) preferences[k]=change[k]; });
        try { api.setPreferenceObject(PREF,preferences); } catch(e) { console.warn('Measey preferences: '+e); }
    }
    if(!loaded||loaded.defaultsVersion!==130)savePrefs();
    function saveLibraries() { api.setPreferenceObject(LIBS,{libraries:libraries,activeIndex:libraryIndex}); }
    function refresh(layout) { if(panel && !closed) { if(layout) panel.layoutChanged(); else panel.refresh(); } }
    function status(text) { state.status=text; refresh(); }
    function selectionToken() { try { return api.getActiveComp()+'|'+api.getSelectedKeyframeIds().slice().sort().join(','); } catch(e) { return ''; } }
    var debounce = new api.Timer({onTimeout:function() {
        if(closed || busy || !pendingKind || (pendingKind==='custom'&&!preferences.autoApply) || (pendingKind==='power'&&!preferences.applyOnDrag)) return;
        if(pendingSelection !== selectionToken()) { readSelection(); return; }
        if(pendingKind==='power') applyPower(); else apply();
    }});
    debounce.setInterval(300); debounce.setRepeating(false);
    var refreshTimer = new api.Timer({onTimeout:function(){ if(!closed && !busy) readSelection(false,true); }});
    refreshTimer.setInterval(60); refreshTimer.setRepeating(false);
    function stopPending() { debounce.stop(); pendingSelection='';pendingKind=''; }
    function readSelection(loadExpression,preserveDraftPreview) {
        if(busy || closed) return;
        var preview=preserveDraftPreview&&draft&&!loadExpression?{activeExpression:state.activeExpression,previewCurves:state.previewCurves,selectedPreset:state.selectedPreset,mixed:state.mixed,draft:draft}:null;
        if(!preview||pendingKind!=='custom'||pendingSelection!==selectionToken())stopPending();
        busy=true;
        try {
            // The UI samples ordinary expression/Bezier descriptors once per
            // distinct curve. Opaque native easing keeps the host fallback.
            selection = MeaseyHost.readSelection(MeaseyMath,{samples:false,previewLimit:PREVIEW_LIMIT});selectionIdentity=selectionToken();
            selectionLayers=Object.create(null);
            (selection.keys||[]).forEach(function(key){selectionLayers[key.id]=true;if(key.layerId)selectionLayers[key.layerId]=true;});
            if(lastSyncedSelection!==selectionIdentity){lastSyncedExpression=null;lastSyncedSelection='';}
            state.selectionPreviewCurves=(selection.previewCurves||[]).slice(0,PREVIEW_LIMIT);
            state.selectionPreviewLimited=(selection.keys||[]).length>PREVIEW_LIMIT;
            var snapshotPowers=Object.create(null);
            state.selectedPowerLevels=(selection.keys||[]).map(function(key){
                var magic=key.magic||{};
                if(!magic.active)return 1;
                var source=magic.expression||'';
                if(!Object.prototype.hasOwnProperty.call(snapshotPowers,source))snapshotPowers[source]=selectedPower(key);
                return snapshotPowers[source];
            });
            lastAppliedCustom=null;
            if(loadExpression) {state.error=false;state.nativeMagic=false;state.customMixed=!!selection.mixed;}
            if(selection.count) state.previewCurves = state.selectionPreviewCurves;
            state.mixed = !!selection.mixed;
            state.previewLabel = selection.count ? selection.count+' selected keyframe'+(selection.count===1?'':'s') : 'EXPRESSION PREVIEW';
            if(selection.count) {
                state.activeExpression=selection.mixed?'':(selection.expression||'');
                if(loadExpression) {
                    state.expression = selection.mixed ? '' : (selection.expression === '' ? '' : (selection.expression || 'x'));
                    state.nativeMagic=!!(selection.segments && selection.segments.length && selection.segments[0].magic.active && !selection.segments[0].magic.expression);
                    recogniseExpression(state.expression);savePrefs({customExpression:state.expression});lastAppliedCustom=null;lastSyncedExpression=state.expression;lastSyncedSelection=selectionIdentity;
                }
                state.status = selection.mixed ? 'Mixed easing. Type an expression to replace the selection.' : (selection.message || state.previewLabel+' · outgoing easing');
            } else {
                if(loadExpression){state.expression='';state.nativeMagic=false;state.customMixed=false;recogniseExpression('');savePrefs({customExpression:''});}
                state.status = loadExpression?'Select a keyframe to get its expression.':'Select keyframes to apply. Adjust Power or type a custom expression.';
            }
            state.selectedPreset = null;
            var currentPresets = presets();
            if(selection.count&&!selection.mixed) currentPresets.some(function(p) { if(expressionsMatch(p.expression,state.activeExpression)){state.selectedPreset=p.id;return true;}return false; });
            draft = false;
            state.canApply = selection.count > 0;
            state.canClear = selection.count > 0;
            state.canFlatten = (selection.segments || []).some(function(s) { return s.magic && s.magic.active; }) || (selection.keys || []).some(function(k) { return k.magic && k.magic.active; });
        } catch(e) { selection=null;selectionLayers=Object.create(null);state.selectionPreviewCurves=[];state.selectionPreviewLimited=false;state.selectedPowerLevels=[];state.status='Could not read selection: '+String(e); state.canApply=false;state.canFlatten=false;state.canClear=false; }
        finally {busy=false;}
        if(preview){state.activeExpression=preview.activeExpression;state.previewCurves=preview.previewCurves;state.selectedPreset=preview.selectedPreset;state.mixed=preview.mixed;draft=preview.draft;}
        refresh();
    }
    function editExpression(text,committed) {
        if(busy||closed) return;
        if(committed&&selectionIdentity!==selectionToken())readSelection(false,true);
        if(committed && !draft && (text===lastAppliedCustom||(text===lastSyncedExpression&&lastSyncedSelection===selectionToken()))) return;
        lastSyncedExpression=null;lastSyncedSelection='';
        stopPending();
        state.expression=text; state.mixed=false;state.customMixed=false;state.nativeMagic=false; state.selectedPreset=null; draft=true;
        savePrefs({customExpression:text});
        var check=recogniseExpression(text);
        if(!check.ok) { state.activeExpression='';state.previewCurves=[];state.error=true;state.status=check.error; refresh(); return; }
        state.error=false;
        state.activeExpression=check.expression;state.previewCurves=[{expression:check.expression}];
        state.status=preferences.autoApply ? 'Valid expression · applying after typing pauses…' : 'Valid expression · click Apply to update selected keys.';
        refresh();
        if(preferences.autoApply) { pendingSelection=selectionToken();pendingKind='custom'; if(committed) apply(); else debounce.start(); }
    }
    function mutate(action,preserveOnFailure) {
        stopPending(); busy=true;
        var savedDraft={expression:state.expression,activeExpression:state.activeExpression,previewCurves:state.previewCurves,selectedPreset:state.selectedPreset,mixed:state.mixed,draft:draft};
        var result;
        try { result=action(); } catch(e) { result={message:'Measey: '+String(e),changed:0}; }
        finally { busy=false; }
        readSelection();
        if(preserveOnFailure && result && !result.changed) {state.expression=savedDraft.expression;state.activeExpression=savedDraft.activeExpression;state.previewCurves=savedDraft.previewCurves;state.selectedPreset=savedDraft.selectedPreset;state.mixed=savedDraft.mixed;draft=savedDraft.draft;}
        if(result && result.message) status(result.message);
        return result;
    }
    function apply() {
        if(closed||busy)return;
        var check=MeaseyMath.validate(state.expression,128);
        if(!check.ok) { status(check.error);return; }
        var outcome=mutate(function(){return MeaseyHost.apply(check.expression);},true);
        if(outcome&&outcome.changed)lastAppliedCustom=state.expression;
    }
    function applyPower() {
        if(closed||busy)return;
        stopPending();
        // Key data can change without changing the selection or before its refresh timer fires.
        readSelection(false,true);
        var expression=requestedExpression();
        if(!expression){status('Type a valid expression or choose Power controls.');return;}
        if(!selection||!selection.count){state.activeExpression=expression;state.previewCurves=[{expression:expression}];status('Select keyframes to apply Power.');return;}
        if(!powerNeedsApply()){if(expressionsMatch(state.customCurveExpression||'',expression)){draft=false;lastAppliedCustom=state.expression;}status(state.powerSelected&&preferences.power===1?'Selected keyframes already use Clear and Silver.':'Selected keyframes already match this curve.');return;}
        var result=mutate(function(){return state.powerSelected&&preferences.power===1?MeaseyHost.clear():MeaseyHost.apply(expression);},true);
        if(result&&result.changed&&expressionsMatch(state.customCurveExpression||'',expression))lastAppliedCustom=state.expression;
    }
    function setPower(value,committed,source) {
        if(closed||busy)return;
        stopPending();
        value=decimalNumber(value);
        if(!isFinite(value)||value<1){status('Enter a finite Power of 1 or more, using a point or comma for decimals.');return;}
        if(source!=='numeric')value=Math.max(1,Math.min(12,Math.round(value)));
        else {
            var candidate;
            try{candidate=MeaseyMath.validate(MeaseyMath.powerExpression(value,preferences.direction,preferences.bothMidpoint,preferences.bottom,preferences.top),128);}catch(e){candidate={ok:false,error:String(e)};}
            if(!candidate.ok){status(candidate.error);return;}
        }
        savePrefs({power:value});showPower(committed,source==='numeric');
    }
    function decimalNumber(value) {
        if(typeof value==='string'){
            value=value.trim();
            if(!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value))return NaN;
            value=Number(value.replace(',','.'));
        }
        return typeof value==='number'&&isFinite(value)?value:NaN;
    }
    function setBothMidpoint(value,committed,source) {
        if(closed||busy)return;
        stopPending();value=decimalNumber(value);
        if(!isFinite(value)||value<0.01||value>0.99){status('Enter a Both midpoint from 0.01 to 0.99, using a point or comma for decimals.');return;}
        if(source==='drag')value=Math.round(value*100)/100;
        savePrefs({bothMidpoint:value});
        if(preferences.direction==='in out')showPower(committed,source==='numeric');else {
            syncGeneratedExpression();state.activeExpression=generatedExpression();state.previewCurves=[{expression:state.activeExpression}];state.mixed=false;state.selectedPreset=null;draft=false;refresh();
        }
    }
    function openMidpointEditor() {
        openWeightEditor('midpoint');
    }
    function openWeightEditor(kind) {
        if(closed||busy)return;
        if(!state.powerSelected||(kind!=='bottom'&&kind!=='top'&&kind!=='midpoint'))return;
        if(kind==='midpoint'&&preferences.direction!=='in out')return;
        if(kind==='bottom'&&preferences.direction==='out')return;
        if(kind==='top'&&preferences.direction==='in')return;
        if(panel&&typeof panel.openWeightEditor==='function')panel.openWeightEditor(kind);
        else if(kind==='midpoint'&&panel&&typeof panel.openMidpointEditor==='function')panel.openMidpointEditor();
    }
    function resetWeights() {
        if(closed||busy)return;
        stopPending();savePrefs({bottom:0,top:0,bothMidpoint:0.5});showPower(true,true);
    }
    function setEndpoint(side,value,committed,source) {
        if(closed||busy||(side!=='bottom'&&side!=='top'))return;
        stopPending();value=decimalNumber(value);
        if(!isFinite(value)||value<0||value>1){status('Drag the endpoint handle toward the centre to make that end less flat.');return;}
        if(source==='drag')value=Math.round(value*100)/100;
        var changes={};changes[side]=value;savePrefs(changes);
        var active=preferences.direction==='in out'||(side==='bottom'&&preferences.direction==='in')||(side==='top'&&preferences.direction==='out');
        if(active)showPower(committed,source==='numeric');else {
            syncGeneratedExpression();state.activeExpression=generatedExpression();state.previewCurves=[{expression:state.activeExpression}];state.mixed=false;state.selectedPreset=null;draft=false;refresh();
        }
    }
    function setDirection(value) {
        if(closed||busy||['in','out','in out'].indexOf(value)<0)return;
        stopPending();savePrefs({direction:value});showPower(preferences.applyOnDirection,true);
    }
    function showPower(committed,numeric) {
        syncGeneratedExpression();var expression=generatedExpression();
        state.activeExpression=expression;state.previewCurves=[{expression:expression}];state.mixed=false;state.selectedPreset=null;draft=false;
        refresh();
        if(numeric){if(committed)applyPower();return;}
        if(!preferences.applyOnDrag)return;
        if(committed)applyPower();
        else if(powerNeedsApply()){pendingSelection=selectionToken();pendingKind='power';debounce.start();}
    }
    function clear() {
        if(closed||busy)return;
        var result=mutate(function(){return MeaseyHost.clear();});
        if(result&&result.changed){savePrefs({power:1});syncGeneratedExpression();state.activeExpression=generatedExpression();refresh();}
    }
    function flatten() { if(closed||busy)return;mutate(function(){return MeaseyHost.flatten(MeaseyMath);}); }
    function presets() { return libraries[libraryIndex].presets; }
    function selectPreset(id) {
        if(closed||busy)return;
        var p=presets().filter(function(p){return p.id===id;})[0]; if(!p)return;
        stopPending(); state.activeExpression=p.expression; state.mixed=false;state.selectedPreset=id;state.previewCurves=[{expression:p.expression}];draft=false;
        if(typeof p.power==='number'){
            var changes={power:p.power,direction:p.type,bottom:p.bottom===undefined?0:p.bottom,top:p.top===undefined?0:p.top};if(p.type==='in out')changes.bothMidpoint=p.bothMidpoint===undefined?0.5:p.bothMidpoint;savePrefs(changes);
        }
        var separateExpression=state.customCurveExpression;recogniseExpression(p.expression);
        if(preferences.syncExpression||!state.powerSelected){state.expression=p.expression;savePrefs({customExpression:p.expression});state.error=false;state.nativeMagic=false;state.customMixed=false;lastSyncedExpression=state.expression;lastSyncedSelection=selectionToken();}
        else state.customCurveExpression=separateExpression;
        refresh();
        if(p.clear||p.power===1) clear(); else mutate(function(){return MeaseyHost.apply(p.expression);},true);
        state.selectedPreset=id;refresh();
    }
    function deletePreset(id) {
        if(closed||busy)return;
        var lib=libraries[libraryIndex],index=-1;
        lib.presets.some(function(p,i){if(p.id===id){index=i;return true;}return false;});
        if(index<0)return;
        var removed=lib.presets.splice(index,1)[0];
        try{saveLibraries();}catch(e){lib.presets.splice(index,0,removed);status('Delete failed: '+String(e));return;}
        if(state.selectedPreset===id)state.selectedPreset=null;
        refresh(true);status('Deleted '+removed.name+' from '+lib.name+'.');
    }
    function promptName(title,initial) { var name=new ui.Modal().showStringInput(title,'Name',initial||'');return name && name.trim()?name.trim().slice(0,40):null; }
    function newLibrary() { var name=promptName('New Measey Library','UNTITLED');if(!name)return;libraries.push({name:name,presets:[]});libraryIndex=libraries.length-1;saveLibraries();refresh(true); }
    function savePreset() {
        var check=MeaseyMath.validate(requestedExpression()||state.activeExpression||state.expression,128);if(!check.ok){status(check.error);return;}
        var name=promptName('Save Measey Preset','CUSTOM');if(!name)return;
        var lib=libraries[libraryIndex],preset={id:'custom-'+Date.now()+'-'+lib.presets.length,name:name.toUpperCase(),type:'',expression:check.expression};
        if(expressionsMatch(check.expression,generatedExpression())){preset.power=preferences.power;preset.type=preferences.direction;preset.clear=preferences.power===1;preset.bottom=preferences.bottom;preset.top=preferences.top;if(preferences.direction==='in out')preset.bothMidpoint=preferences.bothMidpoint;}
        lib.presets.push(preset);saveLibraries();refresh(true);status('Saved '+name.toUpperCase()+' in '+lib.name+'.');
    }
    function importLibrary() {
        try {
            var path=ui.chooseFileToOpen('','Measey Library (*.json)');if(!path)return;
            if(api.getFileSize && api.getFileSize(path)>2048)throw Error('Library exceeds 2 MB.');
            var raw=JSON.parse(api.readFromFile(path));var array=raw.libraries||[raw];var added=0;
            array.slice(0,50).forEach(function(l){var lib=normaliseLibrary(l);if(lib){libraries.push(lib);added++;}});
            if(!added)throw Error('No usable Measey libraries found.');
            libraryIndex=libraries.length-1;saveLibraries();refresh(true);status('Imported '+added+' librar'+(added===1?'y.':'ies.'));
        }catch(e){status('Import failed: '+e);}
    }
    function exportLibrary() {
        try {var lib=libraries[libraryIndex];var path=ui.chooseFileToSave(lib.name+'.json','Measey Library (*.json)');if(!path)return;if(!api.writeToFile(path,JSON.stringify(lib,null,2),true))throw Error('Could not write library.');status('Library exported.');}catch(e){status('Export failed: '+e);}
    }
    function item(name,fn,enabled){ui.addMenuItem({name:name,onMouseRelease:fn,enabled:enabled!==false});}
    function separator(){item('',function(){});}
    function showLibrarySettings() {
        ui.clearContextMenu();
        item('Save Preset…',savePreset);item('New Library…',newLibrary);item('Import Library…',importLibrary);item('Export Current Library…',exportLibrary);
        separator();item('Library',function(){},false);
        libraries.forEach(function(l,i){item('    '+l.name+(libraryIndex===i?' ✓':''),function(){libraryIndex=i;saveLibraries();refresh(true);});});
        separator();item('Preset layout',function(){},false);
        ['list','grid'].forEach(function(v){item('    '+(v==='list'?'List':'Grid')+(preferences.layout===v?' ✓':''),function(){savePrefs({layout:v});refresh(true);});});
        ui.showContextMenu();
    }
    function showSettings() {
        ui.clearContextMenu();
        item('Apply on type'+(preferences.autoApply?' ✓':''),function(){if(pendingKind==='custom')stopPending();savePrefs({autoApply:!preferences.autoApply});status(preferences.autoApply?'Valid custom edits apply after 300 ms.':'Custom typing is manual. Use custom Apply.');});
        item('Apply on drag'+(preferences.applyOnDrag?' ✓':''),function(){if(pendingKind==='power')stopPending();savePrefs({applyOnDrag:!preferences.applyOnDrag});status(preferences.applyOnDrag?'Power and graph handle dragging apply after 300 ms.':'Dragging previews only. Use Apply or enable Apply on direction.');});
        item('Apply on direction'+(preferences.applyOnDirection?' ✓':''),function(){savePrefs({applyOnDirection:!preferences.applyOnDirection});status(preferences.applyOnDirection?'In, Both and Out apply the curve when clicked.':'In, Both and Out update the preview. Use Apply to update selected keyframes.');});
        item('Sync expression'+(preferences.syncExpression?' ✓':''),function(){savePrefs({syncExpression:!preferences.syncExpression});if(preferences.syncExpression&&state.powerSelected){stopPending();syncGeneratedExpression();draft=false;}refresh();});
        separator();item('Measey Version '+VERSION,function(){},false);
        item('Expression Help',function(){new ui.Modal().showMessage('Measey Expressions\n\nUse normalized x from 0 to 1.\n\npow(x, 3)\n1 - pow(1 - x, 5)\nx < 0.5 ? pow(2*x,4)/2 : 1-pow(2*(1-x),4)/2\n\nThe Power slider ranges from 1 to 12 in whole numbers. Typed Power values can exceed 12 and retain decimals, with either a point or comma, such as 1.539 or 1,539. All automatic Apply options start off. Power 1 clears Magic Easing and sets Silver. Committed numeric entries apply immediately. Direction buttons preview by default; enable Apply on direction to apply when clicked. Apply on drag controls the Power slider and graph handle application; Apply on type controls custom text independently. Bottom and top handles reduce endpoint flatness without moving start/end values. In shows the bottom handle, Out the top, and Both both; they default to flat. Drag toward the centre, click to open its native numeric dialog, or right-click to reset an endpoint. Right-click empty graph space and choose Reset Weights to restore both endpoints and the midpoint together. The Both midpoint ranges from 0.01 to 0.99. Dragging snaps to 0.01; a short click opens a titled native numeric dialog. In and Out keep the remembered Both midpoint without using it. Power Apply is enabled when selected keys need the requested curve.\n\nSync expression copies generated Power, direction, midpoint and endpoint changes into the expression field. Turn it off to keep separate text. Typing or Get Expression recognizes matching Power curves and updates the controls; unrecognized expressions show no selected Power or direction. Power Apply uses the current custom expression when no Power curve is selected. Clear synchronizes to x when enabled; Flatten keeps the source formula as a reference. Library settings manages saved and imported presets; new libraries start empty. Right-click a preset to delete it. Selected curves remain visible as overlays while you edit the current formula.\n\nSupports arithmetic, powers (^), math functions, if(), ternary conditions and var name := …; declarations. Unsupported ExprTk loops/vectors show an error. Flatten fits a Bézier and reports approximation error.');});
        ui.showContextMenu();
    }
    var controller={getState:function(){state.layout=preferences.layout;state.autoApply=preferences.autoApply;state.applyOnDrag=preferences.applyOnDrag;state.applyOnDirection=preferences.applyOnDirection;state.syncExpression=preferences.syncExpression;state.mode=preferences.mode;state.graphHeight=preferences.graphHeight;state.power=preferences.power;state.bothMidpoint=preferences.bothMidpoint;state.bottom=preferences.bottom;state.top=preferences.top;state.powerExpression=requestedExpression();if(!state.powerSelected)state.activeExpression=state.powerExpression;state.maxPower=12;state.canApplyPower=powerNeedsApply();state.direction=preferences.direction;state.libraryName=libraries[libraryIndex].name;return state;},getPresets:presets,editExpression:editExpression,selectPreset:selectPreset,deletePreset:deletePreset,apply:apply,applyPower:applyPower,clear:clear,flatten:flatten,getSelection:function(){readSelection(true);},setPower:setPower,setBothMidpoint:setBothMidpoint,openMidpointEditor:openMidpointEditor,openWeightEditor:openWeightEditor,resetWeights:resetWeights,setEndpoint:setEndpoint,setDirection:setDirection,showSettings:showSettings,showLibrarySettings:showLibrarySettings,savePreferences:savePrefs};
    ui.setTitle('Measey');
    panel=buildMeaseyUI(controller,MeaseyMath);
    ui.addCallbackObject({
        onKeySelectionChanged:function(){if(!busy)readSelection();},
        onCompChanged:function(){if(!busy)readSelection();},
        onSceneChanged:function(){if(!busy)readSelection();},
        onAttrChanged:function(layer,attr){if(busy||MeaseyHost.isBusy()||closed||!selection)return;if(selectionLayers[layer]){refreshTimer.stop();refreshTimer.start();}}
    });
    ui.onClose=function(){closed=true;debounce.stop();refreshTimer.stop();if(panel)panel.onClose();};
    readSelection();ui.show();panel.resize();
})();
